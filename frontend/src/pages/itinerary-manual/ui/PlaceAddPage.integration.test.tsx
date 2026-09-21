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
import { setAccessToken, clearAccessToken } from '@/shared/api/tokenManager';
import { getGetTripsTripIdItineraryQueryKey } from '@/shared/api/generated/trips/trips';
import type {
  EditItineraryRequest,
  ItineraryDaysItemSlotsItem,
  Place,
} from '@/shared/api/generated/schemas';

import { PlaceAddPage } from './PlaceAddPage';

/**
 * TRIP-338 · AC-5 (U1 F-3) — h20 장소 검색 배선. `PlaceExplorePage.integration.test.tsx` 대칭.
 *
 * 무엇을 보장하나(심판 대상 = **실제로 나간 요청**이라 msw 로 관찰):
 *  - 🔴 **P1 (★)** 첫 조회의 나간 `/places` URL 쿼리 키가 {region,category} **부분집합**이다 —
 *    **검색어 파라미터가 없다**(계약에 검색어 키가 없음, 클라가 이름으로 거른다).
 *  - 🔴 **P2 (TRIP-502)** 검색은 **서버가 한다**(`q`) — 검색어를 넣으면 서버를 다시 부르고, 서버가
 *    거른 결과만 남는다(로드된 페이지 한정 검색이 아니다).
 *  - 🔴 **P3** 카테고리 칩은 `category` 파라미터로 **서버를 다시 부른다**.
 *  - 🔴 **P4 (TRIP-502)** 목록 끝에 닿으면 `nextCursor` 로 다음 장을 이어 받는다(무한 스크롤).
 *
 * TRIP-798(h13) 추가 — add→PUT 전체 플로우·삽입 index·칩 재편·시트화 재구성:
 *  - 🟢선제 **A6** add press → 시각시트 → PUT 바디에 poiId + 캐시 무효화(TRIP-338 W-1 회귀 심판).
 *  - 🟢선제 **W-2** 일정 미도착이면 add 가 PUT 을 안 낸다(콜드/에러 캐시 소실 가드).
 *  - 🔴 **A7** insertAfter(선행 index) 있으면 그 다음 자리에 splice, 없으면 말미 append.
 *  - 🔴 **A2** 칩 6종·순서 + '전시' press → 서버 category='문화'(라벨≠전송값, 맹점⑤).
 *  - 🔴 **S1/S2** 앱바·완료·CTA·배너 제거 + 시트 헤더 "장소 추가 · N일차".
 *  - 🔴 **C1/C2** 아웃라인 "+추가"(필 폐기) + PlaceRowCard 채택(사진 접두) · 🟢 C3 거리줄 미렌더.
 *
 * TRIP-798 묶음 C(시트화) 추가 — 전면 지도 위 peek 시트 재조립:
 *  - 🔴 **SC** 페이지가 MapSheetShell(map-sheet-shell-root)+전면 지도(map-root)를 조립하고,
 *    검색·칩·리스트·카드가 셸 안에 그대로 산다(재조립 무회귀 그물 — P2·P4·A2·C 를 안 깬다).
 *
 * 왜 통합 버킷인가: 최종 직렬화된 URL·나간 PUT 바디·재요청 횟수·캐시 무효화는 msw/스파이만 본다.
 * 3동작 뼈대: 준비=핸들러/래퍼/params → 실행=렌더/입력/칩/add → 단언=나간 URL·PUT 바디·보이는 트리.
 */

// authedClient(생성 클라이언트가 타는 mutator 의 인증 계층)가 @/shared/storage 를 정적으로 물어
// expo-secure-store 실물을 끌어온다 — 목킹해 격리(place-explore 관례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// h13 재구성 후 PlaceAddPage 가 MapSheetShell→MapView(@/shared/map)를 조립한다. 네이버 네이티브
// 지도는 jest 에서 못 뜨므로 관찰용 목으로 격리한다(재구성 전엔 inert — 현재 코드는 map 미import).
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const mockBack = jest.fn();
const mockPush = jest.fn();
// insertAfter 라우트 파라미터 제어용 — 페이지는 useLocalSearchParams 로 insertAfter 를 읽는다(계약).
let mockParams: Record<string, string> = { tripId: 't1' };

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
  router: { back: mockBack, push: mockPush },
  useLocalSearchParams: () => mockParams,
}));

const BASE = 'http://localhost:8080/api/v1';

// 일정 GET/PUT 응답 봉투(days 는 케이스별로 얹는다).
const ITINERARY_ENVELOPE = {
  itineraryId: 'it1',
  tripId: 't1',
  status: 'PLANNED',
  solveMode: 'MINIMAL',
  generationMode: 'MANUAL',
  isFallback: false,
  generationState: 'COMPLETE',
};

function makePlace(
  poiId: string,
  nameKo: string,
  category: Place['category'],
  savedCount: number
): Place {
  return {
    poiId,
    nameKo,
    category,
    lat: 35.1587,
    lng: 129.1604,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount,
    dataStatus: 'ACTIVE',
  };
}

/** 일정 GET 이 지고 오는 기존 슬롯(서버 7필드) — A7 삽입 자리 심판의 앵커. */
function makeSlot(poiId: string): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt: '09:00:00',
    endAt: '10:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
  };
}

/** p2 만 이름에 '해' 가 든다 — 검색 '해' → p2 만 남는 걸 재는 급소. */
const PLACES: Place[] = [
  makePlace('p1', '감천문화마을', '명소', 12),
  makePlace('p2', '해운대 해수욕장', '야경', 30),
  makePlace('p3', '전포 카페거리', '카페', 7),
  makePlace('p5', '자갈치 시장', '맛집', 21),
];

let observed: { method: string; url: string }[] = [];
let putBodies: EditItineraryRequest[] = [];

function hitsOf(method: string, pathname: string) {
  return observed.filter(
    (hit) => hit.method === method && new URL(hit.url).pathname === pathname
  );
}

function classTokens(node: { props: { className?: string } }): string[] {
  return (node.props.className ?? '').trim().split(/\s+/);
}

beforeAll(() => {
  // warn: 배선이 검색 외에 부르는 요청(itinerary GET 등)이 있어도 이 검색 심판을 깨지 않는다.
  server.listen({ onUnhandledRequest: 'warn' });
  server.events.on('request:start', ({ request }) => {
    observed.push({ method: request.method, url: request.url });
  });
});

beforeEach(() => {
  observed = [];
  putBodies = [];
  mockParams = { tripId: 't1' };
  mockBack.mockClear();
  mockPush.mockClear();
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/places`, ({ request }) => {
      const url = new URL(request.url);
      const category = url.searchParams.get('category');
      const q = url.searchParams.get('q');
      // 서버가 category·q(이름 부분일치)로 거른다(TRIP-502) — 응답은 {items, nextCursor}.
      let result = PLACES;
      if (category !== null) {
        result = result.filter((place) => place.category === category);
      }
      if (q) result = result.filter((place) => place.nameKo.includes(q));
      return HttpResponse.json({ items: result, nextCursor: null });
    }),
    // 방어 핸들러 — 배선이 현재 일정을 읽거나 저장해도 검색 심판이 안 깨지게(응답 형태만 최소).
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json({
        ...ITINERARY_ENVELOPE,
        days: [{ date: '2026-06-10', slots: [] }],
      })
    ),
    http.get(`${BASE}/trips/:tripId`, () =>
      HttpResponse.json({
        tripId: 't1',
        title: '부산',
        startDate: '2026-06-10',
        endDate: '2026-06-12',
        party: 2,
        preferenceSnapshot: {},
        destinations: [{ seq: 1, region: '부산', nights: 2 }],
        status: 'PLANNED',
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-01T00:00:00Z',
      })
    ),
    // 나간 PUT 바디를 관측한다(add→PUT·삽입 순서 심판의 급소).
    http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
      putBodies.push((await request.json()) as EditItineraryRequest);
      return HttpResponse.json({
        ...ITINERARY_ENVELOPE,
        days: [{ date: '2026-06-10', slots: [] }],
      });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    // gcTime 0 — 기본 타이머가 테스트 종료 후에도 Node 프로세스를 붙잡는다(리포 실측).
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

/** 스파이용 client 를 밖에서 만들어 넘긴다(invalidateQueries 관측 — A6b). */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
}

function renderPageWith(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(<PlaceAddPage tripId="t1" />, { wrapper: Wrapper });
}

/** 카드가 그려질 때까지 만든다 — 이후 증가분/좁혀짐이 이 칸의 사정거리다. */
async function renderPage() {
  render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
  await waitFor(() =>
    expect(
      screen.getAllByTestId(/^itinerary-place-card-/).length
    ).toBeGreaterThan(0)
  );
}

/** add press → 시각시트 → onApply(기본 시각) — add→PUT 플로우 발화. */
async function addPlaceAndApply(poiId: string) {
  fireEvent.press(await screen.findByTestId(`itinerary-place-add-${poiId}`));
  fireEvent.press(await screen.findByTestId('itinerary-edit-time-apply'));
}

describe('🔴 P1 · AC-5 (★) — 첫 조회 URL 에 검색어 파라미터가 없다', () => {
  it('나간 /places 쿼리 키가 {region,category} 부분집합이다 (검색어 키 부재)', async () => {
    await renderPage();

    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits.length).toBeGreaterThanOrEqual(1);

    // ★ 나간 URL 쿼리 키가 계약이 허용한 둘(region·category) 밖으로 안 나간다 —
    //   search·q·query·keyword·nameKo 같은 검색어 키가 애초에 안 실린다(클라가 이름으로 거른다).
    const keys = [...new URL(hits[0].url).searchParams.keys()];
    expect(keys.every((k) => k === 'region' || k === 'category')).toBe(true);
  });
});

describe('🔴 P2 · AC-5·TRIP-502 — 검색은 서버가 한다(q) — 로드된 페이지 한정이 아니다', () => {
  it('검색 "해" → q 로 서버를 다시 부르고, 서버가 거른 결과(p2)만 남는다', async () => {
    await renderPage();

    fireEvent.changeText(screen.getByTestId('itinerary-place-search'), '해');

    // 검색은 서버가 한다 — '해' 안 든 p1 은 사라지고, q 를 실은 새 요청이 나간다(로드된 페이지 한정 아님).
    await waitFor(() =>
      expect(screen.queryByTestId('itinerary-place-card-p1')).toBeNull()
    );
    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(new URL(hits[hits.length - 1].url).searchParams.get('q')).toBe('해');

    // 서버가 거른 결과: '해' 든 p2 만 남고, 안 든 p3 는 없다.
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-place-card-p2')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('itinerary-place-card-p3')).toBeNull();
  });
});

describe('🔴 P3 · AC-5 — 카테고리 칩은 category 파라미터로 서버를 다시 부른다', () => {
  it('맛집 칩 → 두 번째 /places 요청에 category=맛집 이 실린다', async () => {
    await renderPage();

    fireEvent.press(screen.getByTestId('itinerary-place-category-맛집'));

    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(2)
    );
    // URL.searchParams.get 이 퍼센트 인코딩을 자동 디코드 — 한글 enum 비교가 성립한다.
    const second = hitsOf('GET', '/api/v1/places')[1];
    expect(new URL(second.url).searchParams.get('category')).toBe('맛집');
  });
});

describe('🔴 P4 · TRIP-502 — 모두 보기는 커서로 이어 받는다 (무한 스크롤)', () => {
  it('목록 끝에 닿으면 nextCursor 로 다음 장을 이어 받는다', async () => {
    const PAGE2 = [makePlace('p9', '태종대', '명소', 5)];
    // 첫 장은 nextCursor 를 주고, cursor 가 실린 요청엔 다음 장을 준다.
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return cursor
          ? HttpResponse.json({ items: PAGE2, nextCursor: null })
          : HttpResponse.json({ items: PLACES, nextCursor: 'C2' });
      })
    );

    await renderPage();

    // 목록 끝에 닿음 → 다음 장 요청. onEndReached 배선을 지우면 p9 가 안 와 red 가 된다(뮤테이션 심판).
    fireEvent(screen.getByTestId('itinerary-place-list'), 'endReached');

    await waitFor(() =>
      expect(screen.getByTestId('itinerary-place-card-p9')).toBeOnTheScreen()
    );
    // 다음 장 요청에 cursor 가 실린다.
    const hits = hitsOf('GET', '/api/v1/places');
    expect(new URL(hits[hits.length - 1].url).searchParams.get('cursor')).toBe(
      'C2'
    );
  });
});

describe('🟢 A6 · TRIP-798/338 — add → PUT + 캐시 무효화 (W-1 회귀 심판)', () => {
  it('A6a · add press → 시각시트 → 나간 PUT 바디에 추가한 poiId 가 실린다', async () => {
    await renderPage();
    await addPlaceAndApply('p1');

    await waitFor(() =>
      expect(
        hitsOf('PUT', '/api/v1/trips/t1/itinerary').length
      ).toBeGreaterThanOrEqual(1)
    );
    const last = putBodies[putBodies.length - 1];
    const day = last.days.find((d) => d.date === '2026-06-10');
    // 나간 봉투의 해당 일자 슬롯에 방금 추가한 p1 이 실린다.
    expect(day?.slots.map((slot) => slot.poiId)).toContain('p1');
  });

  it('A6b · PUT 성공 → 일정 GET 캐시가 무효화된다 (누락 시 h19 에 영영 안 보임)', async () => {
    const client = makeClient();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    renderPageWith(client);
    await screen.findByTestId('itinerary-place-add-p1');

    await addPlaceAndApply('p1');

    // onSuccess 의 invalidateQueries(일정 키)를 관측 — 이 배선을 지우면 호출 0 으로 red.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: getGetTripsTripIdItineraryQueryKey('t1'),
      })
    );
  });
});

describe('🟢 W-2 · TRIP-338 — 일정 미도착이면 add 가 조용히 소실되지 않는다', () => {
  it('days 가 빈 배열이면 add 가 시각시트를 안 열고 PUT 을 안 낸다', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json({ ...ITINERARY_ENVELOPE, days: [] })
      )
    );
    await renderPage();

    fireEvent.press(await screen.findByTestId('itinerary-place-add-p1'));

    // 담을 대상 일자가 없으니 시트를 안 열고 빈-PUT 도 안 내보낸다(데이터 손실 차단).
    expect(screen.queryByTestId('itinerary-edit-time-apply')).toBeNull();
    expect(hitsOf('PUT', '/api/v1/trips/t1/itinerary')).toHaveLength(0);
  });
});

describe('🔴 A7 · TRIP-798 — 삽입 index 수신 (미전달=말미 append)', () => {
  const TWO_SLOT_DAY = {
    ...ITINERARY_ENVELOPE,
    days: [{ date: '2026-06-10', slots: [makeSlot('sA'), makeSlot('sB')] }],
  };

  it('A7a · insertAfter=0 이면 선행 슬롯 다음 자리(index 1)에 splice 된다', async () => {
    mockParams = { tripId: 't1', insertAfter: '0' };
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(TWO_SLOT_DAY)
      )
    );
    await renderPage();
    await addPlaceAndApply('p1');

    await waitFor(() => expect(putBodies.length).toBeGreaterThanOrEqual(1));
    const day = putBodies[putBodies.length - 1].days.find(
      (d) => d.date === '2026-06-10'
    );
    // 선행 index 0 다음 = [sA, p1, sB].
    expect(day?.slots.map((slot) => slot.poiId)).toEqual(['sA', 'p1', 'sB']);
  });

  it('A7b · insertAfter 미전달이면 말미에 append 된다 (후방호환 무회귀)', async () => {
    // mockParams 는 beforeEach 에서 {tripId:'t1'} — insertAfter 없음.
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(TWO_SLOT_DAY)
      )
    );
    await renderPage();
    await addPlaceAndApply('p1');

    await waitFor(() => expect(putBodies.length).toBeGreaterThanOrEqual(1));
    const day = putBodies[putBodies.length - 1].days.find(
      (d) => d.date === '2026-06-10'
    );
    // 미전달 = 말미 = [sA, sB, p1].
    expect(day?.slots.map((slot) => slot.poiId)).toEqual(['sA', 'sB', 'p1']);
  });
});

describe('🔴 A2 · TRIP-798 — 칩 6종·순서 + 전시→문화 (라벨≠전송값)', () => {
  it('A2a · 칩이 전체/맛집/명소/카페/전시/야경 6종·이 순서로 렌더된다', async () => {
    await renderPage();

    // 노드가 아니라 testID 문자열 배열로 사영한 뒤 비교(785 노드배열 toEqual SIGABRT 회피).
    const chips = screen
      .getAllByTestId(/^itinerary-place-category-/)
      .map((node) => node.props.testID);
    expect(chips).toEqual([
      'itinerary-place-category-all',
      'itinerary-place-category-맛집',
      'itinerary-place-category-명소',
      'itinerary-place-category-카페',
      'itinerary-place-category-전시',
      'itinerary-place-category-야경',
    ]);
  });

  it("A2b · '전시' 칩 press → 서버 category 로 '문화'가 실린다 (라벨 '전시'가 값으로 안 샌다)", async () => {
    await renderPage();

    fireEvent.press(screen.getByTestId('itinerary-place-category-전시'));

    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places').length).toBeGreaterThanOrEqual(2)
    );
    const hits = hitsOf('GET', '/api/v1/places');
    const category = new URL(hits[hits.length - 1].url).searchParams.get(
      'category'
    );
    expect(category).toBe('문화');
    expect(category).not.toBe('전시');
  });
});

describe('🔴 S1·S2 · TRIP-798 — 시트화(앱바·완료·CTA·배너 제거 + 시트 헤더)', () => {
  it('S1 · 앱바(뒤로·완료)·하단 CTA·안내/notReady 배너가 없다', async () => {
    await renderPage();

    expect(screen.queryByTestId('itinerary-place-done')).toBeNull();
    expect(screen.queryByTestId('itinerary-place-back')).toBeNull();
    expect(screen.queryByTestId('itinerary-place-back-cta')).toBeNull();
    expect(screen.queryByTestId('itinerary-place-notready')).toBeNull();
    expect(screen.queryByText('추가하면 빈 일정에 순서대로 담겨요')).toBeNull();
  });

  it('S2 · 시트 헤더 "장소 추가 · 1일차"를 그린다', async () => {
    await renderPage();

    expect(screen.getByText('장소 추가 · 1일차')).toBeOnTheScreen();
  });
});

describe('🔴 C1·C2·C3 · TRIP-798 — 카드 (아웃라인 +추가 · PlaceRowCard 채택 · 거리줄)', () => {
  it('C1 · "+추가" 버튼이 아웃라인이다 (빨강 필 폐기)', async () => {
    await renderPage();

    const tokens = classTokens(screen.getByTestId('itinerary-place-add-p1'));
    // 아웃라인 구조 가드 — 필(bg-primary) 폐기 + 테두리(border) 존재. 색 hex·64px 는 6-b.
    expect(tokens).not.toContain('bg-primary');
    expect(tokens).toContain('border');
  });

  it('C2 · 사진 있는 장소면 PlaceRowCard 사진 leaf(접두 itinerary-place-card)를 그린다', async () => {
    server.use(
      http.get(`${BASE}/places`, () =>
        HttpResponse.json({
          items: [
            {
              ...makePlace('pimg', '사진장소', '명소', 3),
              imageUrl: 'https://example.com/x.jpg',
            },
          ],
          nextCursor: null,
        })
      )
    );
    await renderPage();

    // PlaceRowCard 채택 증거 — 사진 있는 장소면 접두 `itinerary-place-card` 의 photo leaf 가 뜬다.
    expect(
      screen.getByTestId('itinerary-place-card-photo-pimg')
    ).toBeOnTheScreen();
  });

  it('C3 · 거리 데이터가 없으면 거리줄을 그리지 않는다 (지어내기 금지, INV-3)', async () => {
    await renderPage();

    expect(screen.queryByTestId('itinerary-place-distance-p1')).toBeNull();
  });
});

describe('🔴 SC · TRIP-798 묶음 C — MapSheetShell peek 시트 조립 (시트화)', () => {
  it('SC1 · 페이지가 MapSheetShell(map-sheet-shell-root) 로 시트를 조립하고 전면 지도(map-root) 를 깐다', async () => {
    await renderPage();

    // 현행 페이지는 View+SafeAreaView 로 헤더만 그리고 @/shared/map 을 안 물어 둘 다 부재 → red.
    // 재조립 후엔 MapSheetShell(widgets)이 시트+전면 지도를 조립한다(features→widgets 는 pages 가 조립).
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
  });

  it('SC2 · 검색·칩·리스트·카드가 셸 안에 그대로 관측된다 (재조립 무회귀 그물)', async () => {
    await renderPage();

    // 셸 조립 확인과 함께 foundation testID 전부 생존 — 재조립이 P2·P4·A2·C 를 안 깬다.
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-place-search')).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-place-category-all')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-place-list')).toBeOnTheScreen();
    expect(
      screen.getAllByTestId(/^itinerary-place-card-/).length
    ).toBeGreaterThan(0);
  });
});
