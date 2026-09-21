import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { CoPickCompletePage } from './CoPickCompletePage';

/**
 * TRIP-796 · AC-1~9 h11 "같이 결과 · CoPick 완료" 얼굴을 **실 HTTP 로** 태우는 심판
 * (01b D1~D8 · 계약 플립 — 옛 CoPickCompleteScreen(features) 얼굴을 공용 지도+시트 셸로 갈아끼운다).
 *
 * 무엇을 보장하나:
 *  - 🔴 셸 얼굴이 뜬다 — 전면 지도(`map-root`) + day-chip 오버레이(`sheet-daychip-*`) +
 *    시트 헤더(`sheet-header-*`) + 슬롯 카드 5개(`slot-stopcard-*`) + 단일 CTA(`sheet-cta-*`).
 *    옛 완성 화면 루트(`itinerary-copick-complete-root`)는 사라진다(AC-1).
 *  - 🔴 **전 슬롯 검증 시각 칩**(AC-2, BR-U3-07 개정) — 옛 "비고정 시각 렌더 0"의 **정반대**.
 *    비고정=`HH:mm–HH:mm`(en-dash), 고정 숙소=단일 `21:00`+부제+고정 배지(AC-3).
 *  - 🔴 "다른 후보 ›" 링크가 **전 슬롯 0개**(h08과 다름 · AC-5) · INV-3 소요시간 0(AC-4).
 *  - 🔴 헤더 "부산 여행 · 1일차 · 6월 10일…" + meta "4/4 골랐어요"(N=비고정 4 · AC-6).
 *  - 🔴 단일 CTA "확정하기" → h14 push 완전일치 1회 · "다시 짜기" 부재(AC-7).
 *  - 🔴 GET 500 → error 얼굴·셸 부재 / 로딩 → 셸 부재(AC-8 · INV-4).
 *
 * ⚠️ 함정(02a §4):
 *  - ★2 en-dash `–`(U+2013): 비고정 시각칩 완전일치가 이 구분자를 강제. 고정은 단일 `21:00`
 *    (완전일치라 `21:00–21:00` 오구현이 red).
 *  - ★5 meta 카운트는 비고정만(4/4). coPickProgress(고정 포함 5/5) 재사용 시 red.
 *  - ★7 "1일차"는 day-chip·헤더 dayLabel 둘 다 그린다 → getByText('1일차') 금지, testID 로만.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=화면을 열고/누른다 → 단언=보이는 얼굴·testID·나간 요청.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// 지도는 이 칸의 심판 대상이 아니다 — 남는 props 를 통과시키는 관찰 마커(map-root)로 바꾼다.
// 셸이 `center` 를 반드시 넘겨야 이 목이 `center.lat` 접근에서 안 죽는다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const DAY1 = '2026-06-10';

/** 4일 여행 — day-chip 개수의 출처는 `days.length` 가 아니라 이 두 날짜다(01b D2). title(❗name 아님). */
function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: DAY1,
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/**
 * 선택일(day 1) 5슬롯 — 비고정 4 + 고정 1(숙소). AC-2·3·5·6 을 한 픽스처로 잰다.
 *  - poi-hotel 은 isFixed=true(고정) → 시각칩은 **단일 21:00**(범위 아님) + 부제 + 고정 배지(AC-3).
 *  - 비고정 4개는 전부 시각 range 칩(AC-2, 옛 "비고정 시각 0"의 정반대).
 *  - N(비고정)=4 → meta "4/4 골랐어요"(AC-6 · coPickProgress 5/5 재사용이면 red).
 *  - lat/lng 를 실어 셸 지도(map-root)가 마운트되고 페이지가 center 를 계산하게 한다.
 */
function daySlots(): ItineraryDaysItemSlotsItem[] {
  return [
    {
      poiId: 'poi-a',
      startAt: '10:00:00',
      endAt: '11:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      tags: ['바다', '산책'],
      nameKo: '광안리 해변',
      category: '자연',
      imageUrl: null,
      distanceRange: null,
      lat: 35.153,
      lng: 129.118,
    },
    {
      poiId: 'poi-b',
      startAt: '11:30:00',
      endAt: '12:10:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      tags: ['전망', '야경'],
      nameKo: '황령산 전망대',
      category: '자연',
      imageUrl: null,
      distanceRange: '2.1km',
      lat: 35.137,
      lng: 129.089,
    },
    {
      poiId: 'poi-c',
      startAt: '13:00:00',
      endAt: '14:30:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      tags: ['미술'],
      nameKo: '부산시립미술관',
      category: '전시',
      imageUrl: null,
      distanceRange: '0.8km',
      lat: 35.166,
      lng: 129.135,
    },
    {
      poiId: 'poi-d',
      startAt: '14:30:00',
      endAt: '15:15:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      tags: ['감성', '브런치'],
      nameKo: '웨이브온 카페',
      category: '카페',
      imageUrl: null,
      distanceRange: '0.6km',
      lat: 35.201,
      lng: 129.216,
    },
    {
      poiId: 'poi-hotel',
      startAt: '21:00:00',
      endAt: '21:00:00',
      isFixed: true,
      endsNextDay: false,
      hasViolation: false,
      tags: [],
      nameKo: '해운대 그랜드 호텔',
      category: '숙소',
      imageUrl: null,
      distanceRange: '0.6km',
      lat: 35.163,
      lng: 129.16,
    },
  ];
}

function itinerary(): Itinerary {
  const days: ItineraryDaysItem[] = [{ date: DAY1, slots: daySlots() }];
  return {
    itineraryId: 'itin-796',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'CO_PLAN',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

/** GET /itinerary 응답을 케이스가 정한다. 기본은 완료된 CO_PLAN 일정(→ 셸). */
let itineraryHandler: () => Response | Promise<Response>;

/** 렌더된 문자열 전부를 공백으로 이어 붙인다(소요·% 부정 스캔의 모집단, h07/h08 선례). */
function renderedText(): string {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out.join(' ');
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  setAccessToken('valid-access');
  itineraryHandler = () => HttpResponse.json(itinerary());

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => itineraryHandler())
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false`·`gcTime:0` — 실패 즉시, 잔존 타이머 방지. */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<CoPickCompletePage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

describe('🔴 A1 · AC-1 — 완료 응답이면 지도+시트 셸 얼굴이 뜬다 (계약 플립)', () => {
  it('셸 골격(지도·오버레이·헤더·5슬롯·CTA)이 뜨고 옛 완성 화면 루트는 사라진다', async () => {
    renderPage();

    // 셸 골격.
    await screen.findByTestId('map-sheet-shell-root');
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-daychip-0')).toBeOnTheScreen(); // DayChipOverlay
    expect(screen.getByTestId('sheet-header-title')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-meta')).toBeOnTheScreen();
    // 슬롯 카드 root testID 는 `slot-stopcard-{날짜}#{poiId}`(날짜=digit) — 하위 leaf(time/name…)는
    // `slot-stopcard-{단어}-…`(letter)라 `/^slot-stopcard-\d/` 가 root 5장만 정확히 센다(§5 실검증).
    expect(screen.queryAllByTestId(/^slot-stopcard-\d/)).toHaveLength(5);
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();

    // ★8 옛 완성 화면 루트(features CoPickCompleteScreen) 부재 — 셸로 갈아끼워졌다.
    expect(screen.queryByTestId('itinerary-copick-complete-root')).toBeNull();
    expect(screen.queryByTestId('itinerary-copick-complete-total')).toBeNull();
  });
});

describe('🔴 A2 · AC-2 — 전 슬롯이 검증 시각 칩을 그린다 (옛 "비고정 시각 0"의 정반대 · en-dash)', () => {
  it('5슬롯 전부 시각 칩이고, 비고정 슬롯은 range(HH:mm–HH:mm)다', async () => {
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    // ★1 전 슬롯 시각 칩 — 옛 계약이면 고정 1개뿐이라 red.
    expect(screen.queryAllByTestId(/^slot-stopcard-time-/)).toHaveLength(5);

    // ★2 비고정 range — toHaveTextContent(문자열)=완전일치라 en-dash `–`(U+2013)를 정확히 요구.
    expect(
      screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-a`)
    ).toHaveTextContent('10:00–11:00');
    expect(
      screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-c`)
    ).toHaveTextContent('13:00–14:30');
  });
});

describe('🔴 A3 · AC-3 — 고정 숙소 슬롯은 단일 시각 + 부제 + 고정 배지 (범위 아님)', () => {
  it('고정 슬롯 시각칩은 단일 21:00, 부제는 "저녁 · 숙소 · 변경 불가", 고정 배지가 뜬다', async () => {
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    const hotelKey = `${DAY1}#poi-hotel`;
    // ★2 단일 21:00 — 완전일치라 `21:00–21:00` 범위 오구현이면 red(단일/범위 분기가 이 하나로 잠긴다).
    expect(
      screen.getByTestId(`slot-stopcard-time-${hotelKey}`)
    ).toHaveTextContent('21:00');
    // ★3 부제(발명 display copy, 01b D3 동결) + 고정 배지.
    expect(
      screen.getByTestId(`slot-stopcard-subtitle-${hotelKey}`)
    ).toHaveTextContent('저녁 · 숙소 · 변경 불가');
    expect(
      screen.getByTestId(`slot-stopcard-fixed-${hotelKey}`)
    ).toBeOnTheScreen();

    // 비고정 슬롯엔 부제·고정 배지 부재(부정 짝).
    expect(
      screen.queryByTestId(`slot-stopcard-subtitle-${DAY1}#poi-a`)
    ).toBeNull();
    expect(
      screen.queryByTestId(`slot-stopcard-fixed-${DAY1}#poi-a`)
    ).toBeNull();
  });
});

describe('🔴 A4 · AC-4 — 셸 얼굴에 소요시간·% 가 0건이다 (INV-3, 셸 도착 후 유지)', () => {
  it('분·시간·소요·% 어휘가 화면 어디에도 없다', async () => {
    renderPage();
    // 셸 도착까지 기다린 뒤 스캔 — 셸 부재(현재)면 여기서 red, 전환 후엔 소요 0 이 유지돼 green.
    await screen.findByTestId('map-sheet-shell-root');

    const text = renderedText();
    expect(text).not.toMatch(/\d+\s*(분|시간)|소요/);
    expect(text).not.toContain('%');
  });
});

describe('🔴 A5 · AC-5 — "다른 후보 ›" 링크가 전 슬롯 0개다 (h08과 다름 · 각주/푸터 부재)', () => {
  it('어느 슬롯에도 alt 링크가 없고, ✓직접고름 각주·"모든 슬롯" 푸터도 없다', async () => {
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    // ★4 alt 링크 0 — h08 은 비고정에 2개. h11 은 onPressAlt 미주입이라 0(주입 실수를 이 심판이 잡는다).
    expect(screen.queryAllByTestId(/^slot-stopcard-alt-/)).toHaveLength(0);
    // 옛 각주·푸터 부재.
    expect(screen.queryByText(/직접 고름/)).toBeNull();
    expect(screen.queryByText(/모든 슬롯/)).toBeNull();
  });
});

describe('🔴 A6 · AC-6 — 시트 헤더 3세그 + meta "4/4 골랐어요"(비고정 카운트)', () => {
  it('제목=부산 여행·일차=1일차·날짜=6월 10일, meta=4/4 골랐어요(고정 제외)', async () => {
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    // ★7 "1일차"는 day-chip·헤더 둘 다 그리므로 testID 로만 스코프(getByText 금지).
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      '부산 여행'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('1일차');
    // ★9 날짜 포맷("· 수" vs "(수)")은 강요 안 함 — 정규식 부분.
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      /6월 10일/
    );
    // ★5 meta = 비고정 4 → "4/4". coPickProgress(고정 포함 5/5) 재사용이면 완전일치라 red.
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '4/4 골랐어요'
    );
  });
});

describe('🔴 A7 · AC-7 — 단일 CTA "확정하기" → 확정 일정으로 1회 push (다시 짜기 없음)', () => {
  it('CTA 는 하나뿐이고 press 시 /trips/[tripId]/itinerary 로 tripId 를 실어 한 번 push 한다', async () => {
    renderPage();
    await screen.findByTestId('sheet-cta-root');

    // 단일 CTA — h08 은 2버튼(다시 짜기·확정). h11 은 하나뿐.
    expect(screen.queryAllByTestId(/^sheet-cta-button-/)).toHaveLength(1);
    const confirm = screen.getByTestId('sheet-cta-button-0');
    expect(confirm).toHaveTextContent('확정하기');
    expect(screen.queryByText('다시 짜기')).toBeNull();

    fireEvent.press(confirm);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

    // 완전일치(맹점④) — 'itinerary' 부분문자열은 draft·generating 경로에도 있어 substring 이면
    //   엉뚱한 곳으로 가도 통과한다. h14 는 접미 없는 index 라우트이고 객체형 push 여야 [tripId] 가 해소된다.
    const dest = mockPush.mock.calls[0][0] as {
      pathname?: string;
      params?: { tripId?: string };
    };
    expect(dest.pathname).toBe('/trips/[tripId]/itinerary');
    expect(dest.params?.tripId).toBe(TRIP_ID);
  });
});

describe('🔴 A8 · AC-8 — 얼굴 보존 (INV-4 narrow): 도착 얼굴만 셸', () => {
  it('GET 500 → error 얼굴이 뜨고 셸은 렌더되지 않는다', async () => {
    itineraryHandler = () => new HttpResponse(null, { status: 500 });
    renderPage();

    expect(
      await screen.findByTestId('itinerary-copick-complete-error')
    ).toBeOnTheScreen();
    // ★ broad 로 회귀(에러에도 셸 렌더)하면 여기가 red.
    expect(screen.queryByTestId('map-sheet-shell-root')).toBeNull();
  });

  it('로딩(data===undefined) → 셸이 아니라 로딩 얼굴이다', async () => {
    // ★11 결정론적 loading — itinerary GET 을 미해소로 두면 쿼리가 pending 에 머문다.
    itineraryHandler = () => new Promise<Response>(() => {});
    renderPage();

    expect(
      await screen.findByTestId('itinerary-copick-complete-loading')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('map-sheet-shell-root')).toBeNull();
  });
});

describe('🔴 A9 · AC-1 보강 — 슬롯 사이 거리 커넥터가 셸에 조립된다 (INV-3 거리 verbatim)', () => {
  it('커넥터가 렌더되고 서버 distanceRange(2.1km)를 가공 없이 그대로 그린다', async () => {
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    // 커넥터 존재(AC-1 "커넥터") — 배치 규약(어느 slotKey 로 키잉하는지)엔 커플링하지 않는다.
    expect(screen.queryAllByTestId(/^sheet-connector-/).length).toBeGreaterThan(
      0
    );
    // 서버 distanceRange '2.1km'(poi-b leg)를 verbatim — INV-3(거리만, 소요시간 아님).
    expect(screen.getByText('2.1km')).toBeOnTheScreen();
  });
});
