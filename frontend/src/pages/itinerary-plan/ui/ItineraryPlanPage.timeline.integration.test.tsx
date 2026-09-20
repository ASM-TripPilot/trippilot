import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  ItineraryStatus,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * TRIP-799 · h14 완성 일정(PLANNED)의 **지도+시트 셸 얼굴**을 실 HTTP 로 태우는 심판
 * (01b D1 narrow · AC-1~7·AC-10).
 *
 * 무엇을 보장하나:
 *  - 🔴 PLANNED 완성 일정이면 `ItineraryPlanPage` 가 옛 `TimelineScreen` 대신 **공용 지도+시트 셸**
 *    (`MapSheetShell`)을 조립한다(AC-1). 옛 listed 앵커(`itinerary-view-timeline`·`-map`)는 사라진다.
 *  - 🔴 전 슬롯 검증 시각 칩 — 비고정 `HH:mm–HH:mm`(en-dash U+2013), 고정 숙소 단일 `21:00`(AC-2).
 *  - 🔴 INV-3 — 셸 얼굴 어디에도 소요시간(`분`·`시간`·`소요`)·`%` 0(AC-3).
 *  - 🔴 헤더 "부산 여행 · 1일차 · 6월 10일…" + meta `4곳 · 4.1km`(N=비고정 4, km=legDistance 합, AC-4).
 *  - 🔴 전 슬롯 distanceRange=null → 커넥터 "이동 거리 계산 중" + meta `4곳`(km 생략, AC-5).
 *  - 🔴 고정 숙소 슬롯 부재 → 거점없음 안내 카드 + 링크 push / 숙소 있으면 카드 부재(AC-7).
 *  - narrow 경계 — CONFIRMED 는 기존 `TimelineScreen`, 404 는 기존 notFound 얼굴(셸 부재, AC-10).
 *
 * ⚠️ 함정(02a §4):
 *  - ★8 "1일차"는 day-chip·헤더 dayLabel 둘 다 그린다 → getByText('1일차') 금지, testID 로만.
 *  - ★9 meta 카운트는 비고정만(4곳). totalPlaces·coPickProgress 재사용 시 red.
 *  - ★12 비고정 시각칩 en-dash `–`(U+2013), 고정은 단일 `21:00`(완전일치라 `21:00–21:00` 이면 red).
 *
 * 왜 통합 버킷인가: 얼굴 판정(PLANNED vs CONFIRMED vs notFound)이 심판의 핵심이라 훅을 목하면
 * 그 판정이 테스트의 *가정*이 된다 — 실 HTTP 로 강제해 판정 회귀를 가시화한다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=열고/누른다 → 단언=보이는 얼굴·testID·나간 요청.
 */

// 셸이 `<MapView viewOnly>` 를 마운트하므로 얇은 관찰 마커(map-root)로 바꾼다. 셸이 `center` 를 반드시
// 넘겨야 이 목이 `center.lat` 접근에서 안 죽는다.
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

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '33333333-3333-3333-3333-333333333333';
const DAY1 = '2026-06-10';

/** 4일 여행 — day-chip 수의 출처는 여행 기간(또는 days), title(❗name 아님). */
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

/** 비고정 슬롯 — 사진 없는 슬롯(imageUrl null)을 1개 섞어 플레이스홀더 회귀도 겸한다(완료조건). */
function poi(
  poiId: string,
  startAt: string,
  endAt: string,
  distanceRange: string | null,
  nameKo: string,
  tags: string[]
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
  };
}

/** 고정 숙소 슬롯 — 단일 시각 `21:00`(startAt=endAt) + 고정 배지 + 부제 대상. */
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

/** 비고정 4장(광안리 사진 없음) — 커넥터 합 2.1+0.8+0.6=3.5km(첫 슬롯 distanceRange 는 slice(1)라 미사용). */
function fourPois(distances: (string | null)[]): ItineraryDaysItemSlotsItem[] {
  return [
    poi('poi-a', '10:00:00', '11:00:00', distances[0], '광안리 해변', [
      '바다',
      '산책',
    ]),
    poi('poi-b', '11:30:00', '12:10:00', distances[1], '황령산 전망대', [
      '전망',
    ]),
    poi('poi-c', '13:00:00', '14:30:00', distances[2], '부산시립미술관', [
      '미술',
    ]),
    poi('poi-d', '14:30:00', '15:15:00', distances[3], '웨이브온 카페', [
      '감성',
    ]),
  ];
}

/** status·slots 를 케이스가 정하는 일정 빌더. */
function itineraryOf(
  status: ItineraryStatus,
  slots: ItineraryDaysItemSlotsItem[]
): Itinerary {
  const days: ItineraryDaysItem[] = [{ date: DAY1, slots }];
  return {
    itineraryId: 'itin-799',
    tripId: TRIP_ID,
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

/** default — 비고정 4(2.1·0.8·0.6km) + 고정 숙소 1(0.6km). legDistance(slice(1))=4.1km. */
function plannedDefault(): Itinerary {
  return itineraryOf('PLANNED', [
    ...fourPois([null, '2.1km', '0.8km', '0.6km']),
    hotel('0.6km'),
  ]);
}

/** 거리 계산 중 — 전 슬롯 distanceRange=null → legDistance null → meta km 생략. */
function plannedPending(): Itinerary {
  return itineraryOf('PLANNED', [
    ...fourPois([null, null, null, null]),
    hotel(null),
  ]);
}

/** 거점 없음 — 고정 숙소 슬롯 부재(비고정 4). legDistance(slice(1))=[2.1,0.8,0.6]=3.5km. */
function plannedNoBase(): Itinerary {
  return itineraryOf('PLANNED', fourPois([null, '2.1km', '0.8km', '0.6km']));
}

/** 렌더된 문자열 전부를 공백으로 이어 붙인다(INV-3 스캔 모집단, h11 선례). */
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
  return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

/** trip GET 은 케이스마다 안 갈리니 항상 200, itinerary GET 만 갈린다. */
function useItinerary(response: () => Response) {
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => response())
  );
}

describe('🔴 T1 · AC-1 — PLANNED 완성 일정이면 지도+시트 셸이 뜬다 (narrow, 계약 플립)', () => {
  it('셸 골격(지도·헤더·5슬롯·커넥터·CTA)이 뜨고 옛 TimelineScreen listed 앵커는 사라진다', async () => {
    useItinerary(() => HttpResponse.json(plannedDefault()));
    renderPage();

    // 셸 골격.
    await screen.findByTestId('map-sheet-shell-root');
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-title')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-meta')).toBeOnTheScreen();
    // 카드 root testID 는 `slot-stopcard-{날짜}#{poiId}`(날짜=digit) — `/^slot-stopcard-\d/` 가 root 5장만.
    expect(screen.queryAllByTestId(/^slot-stopcard-\d/)).toHaveLength(5);
    expect(
      screen.queryAllByTestId(/^sheet-connector-\d/).length
    ).toBeGreaterThan(0);
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();

    // ★1 옛 listed 앵커(TimelineScreen)는 PLANNED 경로에서 소멸 — 셸로 갈아끼워졌다.
    expect(screen.queryByTestId('itinerary-view-timeline')).toBeNull();
    expect(screen.queryByTestId('itinerary-view-map')).toBeNull();
  });
});

describe('🔴 T2 · AC-2 — 전 슬롯 검증 시각 칩 (비고정 range en-dash · 고정 숙소 단일)', () => {
  it('5슬롯 전부 시각 칩이고 비고정은 range, 고정 숙소는 단일 21:00 이다', async () => {
    useItinerary(() => HttpResponse.json(plannedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    expect(screen.queryAllByTestId(/^slot-stopcard-time-/)).toHaveLength(5);

    // ★12 en-dash `–`(U+2013) — toHaveTextContent(문자열)=완전일치.
    expect(
      screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-a`)
    ).toHaveTextContent('10:00–11:00');
    expect(
      screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-c`)
    ).toHaveTextContent('13:00–14:30');
    // 고정 숙소 — 단일 21:00(완전일치라 `21:00–21:00` 오구현이면 red).
    expect(
      screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-hotel`)
    ).toHaveTextContent('21:00');
    // 고정 배지·부제(발명 display copy · 01b D3 동결).
    expect(
      screen.getByTestId(`slot-stopcard-fixed-${DAY1}#poi-hotel`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`slot-stopcard-subtitle-${DAY1}#poi-hotel`)
    ).toHaveTextContent('저녁 · 숙소 · 변경 불가');
    // 짝 — 비고정 슬롯엔 고정 배지·부제 부재.
    expect(
      screen.queryByTestId(`slot-stopcard-fixed-${DAY1}#poi-a`)
    ).toBeNull();
    expect(
      screen.queryByTestId(`slot-stopcard-subtitle-${DAY1}#poi-a`)
    ).toBeNull();
  });

  it('T2b · 시각 고정 비숙소(must-visit)는 고정 배지는 있어도 "숙소" 부제가 안 붙는다 (5-b 경고-1)', async () => {
    // 시각 고정 must-visit POI(isFixed·비숙소)를 섞는다. 부제("…· 숙소 · 변경 불가")는 거점없음
    // 판정 hasBase 와 같은 isFixed&&숙소 정의라야 한다 — isFixed 단독으로 붙이면 미술관을 "숙소"로
    // 오표기한다. 고정 배지·단일 시각은 유지, 부제만 부재여야 한다.
    const fixedMustVisit: ItineraryDaysItemSlotsItem = {
      ...poi(
        'poi-fixed-mv',
        '14:00:00',
        '14:00:00',
        '0.8km',
        '부산시립미술관',
        ['미술']
      ),
      isFixed: true,
      category: '명소',
    };
    useItinerary(() =>
      HttpResponse.json(
        itineraryOf('PLANNED', [
          poi('poi-a', '10:00:00', '11:00:00', null, '광안리 해변', ['바다']),
          fixedMustVisit,
        ])
      )
    );
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    // 고정 배지·단일 시각은 유지.
    expect(
      screen.getByTestId(`slot-stopcard-fixed-${DAY1}#poi-fixed-mv`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-fixed-mv`)
    ).toHaveTextContent('14:00');
    // ★ 부제는 부재 — 비숙소 고정에 "숙소" 부제를 붙이면 red(경고-1 뮤테이션 그물).
    expect(
      screen.queryByTestId(`slot-stopcard-subtitle-${DAY1}#poi-fixed-mv`)
    ).toBeNull();
  });
});

describe('🔴 T3 · AC-3 — 셸 얼굴에 소요시간·% 가 0건이다 (INV-3)', () => {
  it('분·시간·소요·% 어휘가 화면 어디에도 없다', async () => {
    useItinerary(() => HttpResponse.json(plannedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    const text = renderedText();
    expect(text).not.toMatch(/\d+\s*(분|시간)|소요/);
    expect(text).not.toContain('%');
  });
});

describe('🔴 T4 · AC-4 — 헤더 3세그 + meta "4곳 · 4.1km"(비고정 카운트·거리 합)', () => {
  it('제목=부산 여행·일차=1일차·날짜=6월 10일, meta=4곳 · 4.1km(고정 제외·legDistance 합)', async () => {
    useItinerary(() => HttpResponse.json(plannedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    // ★8 "1일차"는 day-chip·헤더 둘 다 그리므로 testID 로만 스코프(getByText 금지).
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      '부산 여행'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('1일차');
    // 날짜 포맷("· 수" vs "(수)")은 강요 안 함 — 정규식 부분.
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      /6월 10일/
    );
    // ★9 meta = 비고정 4곳 + 거리 합 4.1km(2.1+0.8+0.6+0.6). totalPlaces·coPickProgress 재사용이면 red.
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '4곳 · 4.1km'
    );
  });
});

describe('🔴 T5 · AC-5 — 거리 계산 중: 커넥터 "이동 거리 계산 중" + meta km 생략', () => {
  it('전 슬롯 distanceRange=null 이면 커넥터가 계산 중이고 meta 는 곳 수만 그린다', async () => {
    useItinerary(() => HttpResponse.json(plannedPending()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    const connectors = screen.queryAllByTestId(/^sheet-connector-distance-/);
    expect(connectors.length).toBeGreaterThan(0);
    connectors.forEach((node) =>
      expect(node).toHaveTextContent('이동 거리 계산 중')
    );

    // ★10 legDistance([null,…])→null → meta km 생략(곳 수만). "4곳 · X.Xkm" 이면 red.
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('4곳');
    expect(screen.getByTestId('sheet-header-meta')).not.toHaveTextContent(/km/);
  });
});

describe('🔴 T7 · AC-7 — 거점 없음: 안내 카드 + 링크 push / 숙소 있으면 카드 부재', () => {
  it('T7a · 고정 숙소 슬롯이 없으면 거점없음 안내 카드가 뜨고 링크 press 로 이동한다', async () => {
    useItinerary(() => HttpResponse.json(plannedNoBase()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    const card = screen.getByTestId('itinerary-plan-no-base');
    // ⚠️ 한 카드가 두 카피(제목+링크)를 담으므로 exact(문자열 인자)는 둘 다 통과 불가 —
    // toHaveTextContent 는 이 RNTL 버전에서 문자열 인자를 exact(자손 join 전체 일치)로 본다.
    // 의도는 "포함"(02a §6)이라 regex(부분 일치)로 각 카피 존재를 잠근다.
    expect(card).toHaveTextContent(/거점 숙소가 없어요/);
    expect(card).toHaveTextContent(/동선 기준 추천 보기/);

    // 링크 press → 항법(침묵 no-op 아님). h15 라우트는 TRIP-800 밖이라 목적지 리터럴은 강요 안 하고
    // (as Href 캐스트·planb-request 선례) push 가 한 번 나갔는지만 잠근다(02a §8).
    fireEvent.press(screen.getByTestId('itinerary-plan-no-base-link'));
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('T7b · 고정 숙소 슬롯이 있으면 거점없음 안내 카드가 없다 (짝)', async () => {
    useItinerary(() => HttpResponse.json(plannedDefault()));
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    expect(screen.queryByTestId('itinerary-plan-no-base')).toBeNull();
  });
});

describe('AC-10 · narrow 경계 — 도착·확정·404 얼굴 보존', () => {
  it('T10a · CONFIRMED 는 기존 TimelineScreen 이고 셸은 안 뜬다 (801까지, 선제 green)', async () => {
    useItinerary(() =>
      HttpResponse.json(
        itineraryOf('CONFIRMED', [
          ...fourPois([null, '2.1km', '0.8km', '0.6km']),
          hotel('0.6km'),
        ])
      )
    );
    renderPage();

    await screen.findByTestId('itinerary-view-timeline');
    expect(screen.queryByTestId('map-sheet-shell-root')).toBeNull();
  });

  it('T10b · 404 는 기존 notFound 얼굴이고 셸은 안 뜬다 (선제 green)', async () => {
    useItinerary(() => new HttpResponse(null, { status: 404 }));
    renderPage();

    await screen.findByTestId('itinerary-view-notfound');
    expect(screen.queryByTestId('map-sheet-shell-root')).toBeNull();
  });
});
