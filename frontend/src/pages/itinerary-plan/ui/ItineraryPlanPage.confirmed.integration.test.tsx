import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * TRIP-801 · h16 확정 일정(CONFIRMED)의 **지도+시트 셸 얼굴**을 실 HTTP 로 태우는 심판
 * (01b D1 계약 플립 · AC-1~6 · INV-3). 799(h14 PLANNED 셸)의 CONFIRMED 짝.
 *
 * 무엇을 보장하나:
 *  - 🔴 CONFIRMED 면 `ItineraryPlanPage` 가 옛 `TimelineScreen` 대신 공용 지도+시트 셸을 조립하고,
 *    지도 위 성공 배너(`itinerary-confirmed-banner`)를 얹는다. 옛 CONFIRMED 앵커는 사라진다(AC-1).
 *  - 🔴 하단 CTA — `일정 수정`→h12 은 항상, `공유하기`→j06 은 공유 카드 캡처 개통(armed) 시에만(TRIP-939
 *    Q2 — 미장전이면 1버튼). 완전일치 push, 활성(AC-2).
 *  - 🔴 헤더 meta 가 "확정됨 · " 접두를 단다(km null 이면 "확정됨 · N곳", AC-3).
 *  - 🔴 슬롯 `openingHoursKnown === false` 에만 휴관 경고 표면이 뜬다(true/null/undefined 부재, AC-4).
 *  - 🔴 읽기전용 — 다른 후보(alt) 링크가 없다(AC-5).
 *  - 🔴 뒤로가기는 내 여행 목록으로 replace(AC-6).
 *  - 🔴 셸 얼굴 어디에도 소요시간·% 가 없다(INV-3, 배너·경고 신규 표면 포함).
 *
 * 왜 통합 버킷인가: 얼굴 판정(CONFIRMED vs PLANNED vs notFound)이 심판의 핵심이라 훅을 목하면
 * 그 판정이 테스트의 *가정*이 된다 — 실 HTTP 로 강제해 판정 회귀를 가시화한다(기존 5파일 관례).
 *
 * ⚠️ 함정(02a §4):
 *  - ★2 CONFIRMED 셸도 `map-sheet-shell-root` 를 쓴다 → 전이 착지 앵커는 `itinerary-confirmed-banner`
 *    (TRIP-939: 공유하기가 개통 전엔 숨으므로 CONFIRMED 전용 배너로 옮김).
 *  - ★5 warning 트리거는 boolean `openingHoursKnown` 하나, 문구는 상수 `휴관일 확인`(요일 발명 금지).
 *  - ★12 "1일차"는 day-chip·헤더 둘 다 → getByText 금지, testID 로만 스코프.
 *  - ★13 meta 카운트는 선택일 **비고정만**(확정됨 접두). totalPlaces·coPickProgress 재사용 시 red.
 */

// 셸이 `<MapView viewOnly>` 를 마운트하므로 얇은 관찰 마커(map-root)로 바꾼다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

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

// jest.mock 팩토리는 호이스트돼 바깥 변수를 못 본다 — `mock` 접두만 예외. `canGoBack` 은 페이지
// handleBack 이 부르므로 반드시 넣는다(없으면 거짓 red).
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
}));

// TRIP-939 AC-2b(Q2) — [공유하기]는 공유 카드 캡처가 장전(`captureShareImage().armed`)됐을 때만
// 보인다(미장전이면 j06 이 보기만 하는 막다른 화면). 홀더로 armed 를 갈아끼운다(기본 false).
const mockShareArmed = { value: false };
jest.mock('@/features/reflection/model/shareCard', () => ({
  ...jest.requireActual('@/features/reflection/model/shareCard'),
  captureShareImage: () => ({ armed: mockShareArmed.value }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '44444444-4444-4444-4444-444444444444';
const DAY1 = '2026-06-10';

/** 4일 여행 — day-chip 수의 출처는 여행 기간, title(❗name 아님). */
function trip() {
  return {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: DAY1,
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 3 }],
    status: 'PLANNED' as const,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/** 비고정 슬롯. `openingHoursKnown` 은 케이스가 주입(AC-4). */
function poi(
  poiId: string,
  startAt: string,
  endAt: string,
  distanceRange: string | null,
  nameKo: string,
  tags: string[],
  openingHoursKnown?: boolean | null
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt,
    endAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags,
    nameKo,
    category: '자연',
    imageUrl: null,
    distanceRange,
    lat: 35.15,
    lng: 129.11,
    openingHoursKnown,
  };
}

/** 고정 숙소 슬롯 — 단일 시각 21:00 + 고정 배지. */
function hotel(distanceRange: string | null): ItineraryDaysItemSlotsItem {
  return {
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
    distanceRange,
    lat: 35.16,
    lng: 129.16,
  };
}

/** 비고정 4장 — poi-c(부산시립미술관)에만 휴관 신호를 케이스가 얹는다. 커넥터 합 slice(1)=4.1km. */
function fourPois(
  distances: (string | null)[],
  openingHoursKnownC?: boolean | null
): ItineraryDaysItemSlotsItem[] {
  return [
    poi('poi-a', '10:00:00', '11:00:00', distances[0], '광안리 해변', ['바다']),
    poi('poi-b', '11:30:00', '12:10:00', distances[1], '황령산 전망대', [
      '전망',
    ]),
    poi(
      'poi-c',
      '13:00:00',
      '14:30:00',
      distances[2],
      '부산시립미술관',
      ['미술'],
      openingHoursKnownC
    ),
    poi('poi-d', '14:30:00', '15:15:00', distances[3], '웨이브온 카페', [
      '감성',
    ]),
  ];
}

/** CONFIRMED 일정 빌더. */
function confirmed(slots: ItineraryDaysItemSlotsItem[]): Itinerary {
  const days: ItineraryDaysItem[] = [{ date: DAY1, slots }];
  return {
    itineraryId: 'itin-801',
    tripId: TRIP_ID,
    status: 'CONFIRMED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

/** default — 비고정 4 + 고정 숙소 1. poi-c openingHoursKnown=false(휴관 경고 트리거). */
function confirmedDefault(): Itinerary {
  return confirmed([
    ...fourPois([null, '2.1km', '0.8km', '0.6km'], false),
    hotel('0.6km'),
  ]);
}

/** 거리 계산 중 — 전 슬롯 distanceRange=null → legDistance null → meta km 생략. */
function confirmedPending(): Itinerary {
  return confirmed([...fourPois([null, null, null, null]), hotel(null)]);
}

/** 렌더된 문자열 전부를 공백으로 이어 붙인다(INV-3 스캔 모집단, h14 선례). */
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
  mockShareArmed.value = false;
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockClear();
  mockCanGoBack.mockReturnValue(true);
  setAccessToken('valid-access');
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

/** trip GET 은 케이스마다 안 갈리니 항상 200, itinerary GET 만 갈린다. */
function useItinerary(response: () => Response) {
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => response())
  );
}

describe('🔴 C1 · AC-1 — CONFIRMED 면 지도+시트 셸 + 성공 배너, 옛 앵커는 사라진다 (계약 플립)', () => {
  it('셸 골격·성공 배너가 뜨고 옛 TimelineScreen CONFIRMED 앵커는 부재한다', async () => {
    useItinerary(() => HttpResponse.json(confirmedDefault()));
    renderPage();

    await screen.findByTestId('map-sheet-shell-root');
    // 지도 위 성공 배너(mapCard) — 정확 카피·색은 6-b 라 정규식 부분(★4).
    expect(screen.getByTestId('itinerary-confirmed-banner')).toHaveTextContent(
      /확정/
    );

    // ★1 옛 CONFIRMED 앵커(TimelineScreen)는 소멸 — 셸로 갈아끼워졌다.
    expect(screen.queryByTestId('itinerary-view-timeline')).toBeNull();
    expect(screen.queryByTestId('itinerary-view-header')).toBeNull();
    expect(screen.queryByTestId('itinerary-view-share')).toBeNull();
    expect(screen.queryByTestId('itinerary-confirmed-note')).toBeNull();
  });
});

describe('🔴 C2 · AC-2 — CTA 가 h12(항상)·j06(캡처 개통 시)으로 push 하고 활성이다', () => {
  it('C2a · 일정 수정(button-0) press → h12 편집 push 1회, 활성', async () => {
    useItinerary(() => HttpResponse.json(confirmedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    const edit = screen.getByTestId('sheet-cta-button-0');
    expect(edit).toBeEnabled();

    fireEvent.press(edit);
    // 형태 완전일치(★2·D5) — 객체형 push(goEdit 관용구), pathname·params 정확히.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/edit',
      params: { tripId: TRIP_ID },
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('C2b · TRIP-939: 캡처 미장전(armed:false)이면 [공유하기]가 없고 [일정 수정] 1버튼이다', async () => {
    // 준비·실행: 확정 일정을 연다(캡처 미장전 = 오늘의 운영 빌드).
    useItinerary(() => HttpResponse.json(confirmedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    // 단언: 두 번째 버튼·'공유하기' 글자가 없다 + 짝 앵커([일정 수정]은 남는다).
    expect(screen.queryByTestId('sheet-cta-button-1')).toBeNull();
    expect(screen.queryByText('공유하기')).toBeNull();
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '일정 수정'
    );
  });

  it('C2c · 캡처 개통(armed:true)이면 공유하기(button-1) press → j06 공유 push 1회, 활성(짝)', async () => {
    mockShareArmed.value = true;
    useItinerary(() => HttpResponse.json(confirmedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    const share = screen.getByTestId('sheet-cta-button-1');
    expect(share).toBeEnabled();

    fireEvent.press(share);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/records/share',
      params: { tripId: TRIP_ID },
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 C3 · AC-3 — 헤더 meta "확정됨 · " 접두 (km null 이면 곳 수만)', () => {
  it('C3a · default: meta = "확정됨 · 4곳 · 4.1km"(비고정 4·legDistance 합)', async () => {
    useItinerary(() => HttpResponse.json(confirmedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    // ★13 확정됨 접두 + 비고정 카운트 + 거리 합(완전일치). totalPlaces·coPickProgress 재사용이면 red.
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '확정됨 · 4곳 · 4.1km'
    );
    // ★12 "1일차"는 day-chip·헤더 둘 다 → testID 로만 스코프.
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      '부산 여행'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('1일차');
  });

  it('C3b · 거리 계산 중: meta = "확정됨 · 4곳"(km 생략)', async () => {
    useItinerary(() => HttpResponse.json(confirmedPending()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '확정됨 · 4곳'
    );
    expect(screen.getByTestId('sheet-header-meta')).not.toHaveTextContent(/km/);
  });
});

describe('🔴 C4 · AC-4 — 휴관 경고는 openingHoursKnown === false 에만 (데이터 구동)', () => {
  it.each([
    [false, true],
    [true, false],
    [null, false],
    [undefined, false],
  ])(
    'poi-c openingHoursKnown=%p → 경고 present=%p',
    async (value, shouldShow) => {
      useItinerary(() =>
        HttpResponse.json(
          confirmed([
            ...fourPois([null, '2.1km', '0.8km', '0.6km'], value),
            hotel('0.6km'),
          ])
        )
      );
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const warning = screen.queryByTestId(
        `slot-stopcard-warning-${DAY1}#poi-c`
      );
      if (shouldShow) {
        expect(warning).toHaveTextContent('휴관일 확인');
      } else {
        expect(warning).toBeNull();
      }
    }
  );

  it('경고 필드 없는 슬롯(poi-a)엔 경고가 안 뜬다 (짝)', async () => {
    useItinerary(() => HttpResponse.json(confirmedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    expect(
      screen.queryByTestId(`slot-stopcard-warning-${DAY1}#poi-a`)
    ).toBeNull();
  });
});

describe('🔴 C5 · AC-5 — 읽기전용: 다른 후보(alt) 링크가 없다', () => {
  it('CONFIRMED 셸 카드에 onPressAlt 미주입 → alt 링크 0개', async () => {
    useItinerary(() => HttpResponse.json(confirmedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    expect(screen.queryAllByTestId(/^slot-stopcard-alt-/)).toHaveLength(0);
  });
});

describe('🔴 C6 · AC-6 — 뒤로가기는 내 여행 목록으로 replace 한다', () => {
  it('sheet-daychip-back press → replace("/(tabs)/itinerary") 1회, back() 미호출', async () => {
    useItinerary(() => HttpResponse.json(confirmedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/itinerary');
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('🔴 C7 · INV-3 — 셸 얼굴에 소요시간·% 가 0건이다 (배너·경고 신규 표면 포함)', () => {
  it('분·시간·소요·% 어휘가 화면 어디에도 없다', async () => {
    useItinerary(() => HttpResponse.json(confirmedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    const text = renderedText();
    expect(text).not.toMatch(/\d+\s*(분|시간)|소요/);
    expect(text).not.toContain('%');
  });
});
