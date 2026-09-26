import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Keyboard } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
 * TRIP-922 추가 — 시트 back 이 유일한 탈출구(루트 Stack headerShown:false):
 *  - 🟢선제 **BK1** `sheet-daychip-back` press → router.back() 1회(셸 기본값이 빈 함수라 배선 누락은 조용하다).
 *
 * TRIP-924 추가 — 후보 0건 안내(검색어 무관 단일 문구, 조회 성공 뒤에만):
 *  - 🔴 **E1** 조회 성공 + 0건 → 리스트 안에 `itinerary-place-empty` "검색 결과가 없어요".
 *  - 🔴 **E2** 첫 조회 대기 중엔 안 뜨고, 응답(0건)이 와야 뜬다(깜빡임 방지).
 *  - 🟢선제 **E3** 1건 이상이면 안 뜬다.
 *
 * TRIP-926 추가 — 지도 중심 폴백(핀 0개면 null-island (0,0) 이 아니라 서울 시청):
 *  - 🔴 **M1** 일정 도착 후 담을 일자가 비었으면(핀 0개) center = 서울 시청.
 *  - 🟢선제 **M2** 핀이 있으면 center = 첫 핀 좌표(무회귀 — 상수로 박아 버리는 구현을 막는 짝).
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

describe('🟢 BK1 · TRIP-922 — 시트 back 은 이전 화면으로 돌아간다 (유일한 탈출구)', () => {
  it('BK1 · 시트 좌상단 back(sheet-daychip-back) press → router.back() 1회', async () => {
    await renderPage();

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

    // 셸이 onBack 미전달을 빈 함수로 채워 배선 누락이 에러 없이 무반응이 된다 — 횟수로만 잡힌다.
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('TRIP-924 · E — 후보 0건 안내 (조회 성공 뒤에만, 검색어 무관 단일 문구)', () => {
  const EMPTY_COPY = '검색 결과가 없어요';

  it('🔴 E1a · 첫 조회가 성공했는데 0건이면 리스트 안에 "검색 결과가 없어요" 가 뜬다 (AC1)', async () => {
    // 준비 — 서버가 빈 목록을 돌려준다.
    server.use(
      http.get(`${BASE}/places`, () =>
        HttpResponse.json({ items: [], nextCursor: null })
      )
    );

    // 실행 — 페이지 렌더.
    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });

    // 단언 — 안내가 문구 그대로(완전 일치) 리스트 **안**에 뜨고, 검색창은 남아 다시 찾을 수 있다.
    expect(
      await screen.findByTestId('itinerary-place-empty')
    ).toHaveTextContent(EMPTY_COPY);
    expect(
      within(screen.getByTestId('itinerary-place-list')).getByTestId(
        'itinerary-place-empty'
      )
    ).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-place-search')).toBeOnTheScreen();
  });

  it('🔴 E1b · 결과가 있다가 검색어로 0건이 되면 같은 문구가 뜬다 (AC1 · 검색어 무관 단일 문구)', async () => {
    // 준비 — 기본 핸들러(4건)로 카드가 뜬 상태.
    await renderPage();

    // 실행 — 아무 이름에도 없는 검색어 → 서버가 0건을 돌려준다.
    fireEvent.changeText(
      screen.getByTestId('itinerary-place-search'),
      '없는장소'
    );

    // 단언 — 카드는 사라지고 안내가 같은 문구로 뜬다.
    expect(
      await screen.findByTestId('itinerary-place-empty')
    ).toHaveTextContent(EMPTY_COPY);
    expect(screen.queryAllByTestId(/^itinerary-place-card-/)).toHaveLength(0);
  });

  it('🔴 E2 · 첫 조회 응답을 기다리는 동안엔 안 뜨고, 성공 응답(0건)이 와야 뜬다 (AC2 · 깜빡임 방지)', async () => {
    // 준비 — 응답을 손으로 풀 때까지 붙잡는 /places(첫 조회 대기 상태를 만든다, 02a ★4).
    let releasePlaces!: () => void;
    const gate = new Promise<void>((resolve) => {
      releasePlaces = resolve;
    });
    server.use(
      http.get(`${BASE}/places`, async () => {
        await gate;
        return HttpResponse.json({ items: [], nextCursor: null });
      })
    );

    // 실행 — 렌더 후 /places 요청이 실제로 나갔는지(=대기 중인지) 확인.
    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places').length).toBeGreaterThanOrEqual(1)
    );

    // 단언 ① — 대기 중: 리스트는 있지만(0건) 안내는 없다.
    expect(screen.getByTestId('itinerary-place-list')).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-place-empty')).toBeNull();

    // 실행 — 응답을 푼다(성공 + 0건).
    releasePlaces();

    // 단언 ② — 그제서야 안내가 뜬다(①이 "원래 안 그리는 코드"로 통과하는 걸 막는 짝).
    expect(
      await screen.findByTestId('itinerary-place-empty')
    ).toHaveTextContent(EMPTY_COPY);
  });

  it('E3 · 후보가 1건 이상이면 안내가 없다 (AC3 · 선제 green)', async () => {
    // 준비/실행 — 기본 핸들러(4건)로 카드가 뜰 때까지 렌더.
    await renderPage();

    // 단언 — 카드가 있으니 안내는 없다.
    expect(screen.queryByTestId('itinerary-place-empty')).toBeNull();
  });
});

describe('TRIP-926 · M — 지도 중심 (핀 0개면 서울 시청, 있으면 첫 핀)', () => {
  // mapViewMock 이 center 를 map-root 텍스트 "lat,lng" 로 노출한다(toHaveTextContent 는 완전 일치).
  const SEOUL_CITY_HALL = '37.5665,126.978';

  it('🔴 M1 · 일정이 도착했는데 담을 일자에 핀이 0개면(빈 일자) 지도 중심이 서울 시청이다 (AC1)', async () => {
    // 준비 — 기본 핸들러: 일정 GET 이 빈 일자(slots: [])를 돌려준다. 캐시를 들여다볼 client.
    const client = makeClient();

    // 실행 — 렌더 후 일정 응답이 캐시에 앉을 때까지 기다리고, 그 변경 알림(setTimeout 0 예약)이
    // 화면에 반영되도록 한 틱 흘린다 — 이 화면엔 "일정 도착"을 보여 주는 표면이 없다(02a ★M-a).
    renderPageWith(client);
    await waitFor(() =>
      expect(
        client.getQueryState(getGetTripsTripIdItineraryQueryKey('t1'))?.status
      ).toBe('success')
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 단언 — 기니만(0,0)이 아니라 서울 시청을 비춘다.
    expect(screen.getByTestId('map-root')).toHaveTextContent(SEOUL_CITY_HALL);
  });

  it('M2 · 담을 일자에 핀이 있으면 지도 중심은 첫 핀 좌표다 (AC2 · 무회귀 선제 green)', async () => {
    // 준비 — 일정 GET 이 좌표 있는 슬롯 2개를 돌려준다(첫 핀 ≠ 둘째 핀 ≠ 서울 시청).
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json({
          ...ITINERARY_ENVELOPE,
          days: [
            {
              date: '2026-06-10',
              slots: [
                { ...makeSlot('s1'), lat: 35.0979, lng: 129.0256 },
                { ...makeSlot('s2'), lat: 35.1587, lng: 129.1604 },
              ],
            },
          ],
        })
      )
    );

    // 실행 — 페이지 렌더.
    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });

    // 단언 — 일정이 도착하면 첫 핀(s1) 좌표로 맞춘다(둘째 핀·폴백이 아니다).
    await waitFor(() =>
      expect(screen.getByTestId('map-root')).toHaveTextContent(
        '35.0979,129.0256'
      )
    );
  });
});

/**
 * TRIP-990 · S6 (#051 · D9 · US-SCHED-07) — 장소 추가 검색 입력이 키보드에 가리지 않도록 시트에 알린다.
 *
 * 검색 입력을 `BottomSheetTextInput` 으로 바꾸고, 이 화면 시트에 `keyboardBehavior="interactive"` 를
 * 명시한다(값은 라이브러리 기본값과 같아 동작으로는 못 가르고, 적혀 있는지만 본다). 기존 검색 입력
 * 테스트(P2 changeText)는 testID 가 그대로라 계속 통과해야 한다. 첫 결과가 키보드 위에 보이는지는 6-b.
 *
 * 3동작 뼈대: 준비=페이지 렌더(카드 도착까지) → 실행=해당 요소 찾기 → 단언=타입·prop.
 */
describe('🔴 S6 · 장소 추가 검색 키보드 처방 (#051 · D9)', () => {
  it('검색 입력이 BottomSheetTextInput 이다 (플레인 TextInput 이면 red)', async () => {
    await renderPage();

    const ids = screen
      .UNSAFE_getAllByType(BottomSheetTextInput)
      .map((node) => node.props.testID);
    expect(ids).toContain('itinerary-place-search');
  });

  it('시트가 keyboardBehavior="interactive" 를 명시한다', async () => {
    await renderPage();

    expect(
      screen.UNSAFE_queryAllByProps({ keyboardBehavior: 'interactive' })
    ).not.toHaveLength(0);
  });
});

/**
 * TRIP-981 · A (#057 · US-SCHED-10 · INV-4) — '+ 추가'를 한 번 누르면 시각 시트가 뜬다.
 *
 * 근본 원인(브리프 후보5): 기본 시각 시트는 딤으로 닫혀도 페이지에 알리지 않아 `pendingPlace` 가 남는다.
 * 시트는 마운트된 채 닫혀 있고, 이후 어떤 행의 '+ 추가'도 다시 열지 못한다. 테스트용 시트 목은 시트를
 * 항상 열린 채로 그려 "닫힌 상태"를 못 만들므로, 시트의 `onClose` 를 불러 딤 닫힘을 흉내 내고
 * "시트가 트리에서 빠졌다 → 다른 행이 새로 연다"를 잰다(실제로 열리는지는 6-b).
 *
 * 함께: 검색 중 첫 탭이 키보드 내리기에 먹히지 않게 목록이 탭을 통과시키고(`keyboardShouldPersistTaps`),
 * 시트가 키보드 밑에 깔리지 않게 '+ 추가'가 키보드를 내린다(`Keyboard.dismiss`).
 *
 * 3동작 뼈대: 준비=페이지 렌더(카드 도착) → 실행=add·close·칩 → 단언=시트 유무·PUT 바디·호출 수·prop.
 */
describe('TRIP-981 · A — 장소 추가 시트의 "+ 추가" 무반응', () => {
  const SHEET = 'itinerary-edit-time-sheet';
  const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;
  let dismiss: jest.SpyInstance;

  beforeEach(() => {
    // 렌더 전에 건다 — onPress={Keyboard.dismiss} 처럼 참조를 렌더 때 잡는 구현도 스파이가 본다.
    dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  });

  afterEach(() => {
    // 테스트가 중간에 실패해도 다음 테스트로 스파이가 새지 않게 여기서 푼다.
    dismiss.mockRestore();
  });

  /** 화면에 그려진 문자열 전부 — 소요시간 부정 스캔의 모집단. */
  function renderedTexts(): string[] {
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
    return out;
  }

  it('🔴 A2 · 시각 시트가 딤으로 닫히면 트리에서 빠지고, 다른 행 "+ 추가"가 시트를 새로 열어 그 장소를 담는다', async () => {
    await renderPage();

    fireEvent.press(screen.getByTestId('itinerary-place-add-p1'));
    const sheet = await screen.findByTestId(SHEET);

    // 딤 탭 닫힘 대리 — 시트의 onClose 를 부른다(없으면 조용히 아무 일도 안 일어난다).
    fireEvent(sheet, 'close');
    await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());

    fireEvent.press(screen.getByTestId('itinerary-place-add-p2'));
    expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));

    await waitFor(() => expect(putBodies.length).toBeGreaterThanOrEqual(1));
    const day = putBodies[putBodies.length - 1].days.find(
      (d) => d.date === '2026-06-10'
    );
    const poiIds = day?.slots.map((slot) => slot.poiId) ?? [];
    expect(poiIds).toContain('p2');
    expect(poiIds).not.toContain('p1');
  });

  it('🔴 A3 · 검색 입력에 포커스가 있을 때 "+ 추가"를 누르면 키보드 내림을 요청한다 (시트가 키보드 밑에 안 깔리게)', async () => {
    await renderPage();
    fireEvent(screen.getByTestId('itinerary-place-search'), 'focus');
    const before = dismiss.mock.calls.length;

    fireEvent.press(screen.getByTestId('itinerary-place-add-p1'));

    expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
    expect(dismiss.mock.calls.length).toBeGreaterThan(before);
  });

  it('🔴 A4 · 후보 목록은 키보드가 떠 있어도 탭을 행에 넘긴다 (keyboardShouldPersistTaps="handled")', async () => {
    await renderPage();

    expect(
      screen.getByTestId('itinerary-place-list').props.keyboardShouldPersistTaps
    ).toBe('handled');
  });

  it('A5 · 칩을 바꿔 목록이 바뀐 뒤에도 새 행 "+ 추가"가 시트를 연다 (특성화 · 선제 green)', async () => {
    await renderPage();

    fireEvent.press(screen.getByTestId('itinerary-place-category-맛집'));
    await waitFor(() =>
      expect(screen.queryByTestId('itinerary-place-card-p1')).toBeNull()
    );
    fireEvent.press(await screen.findByTestId('itinerary-place-add-p5'));

    expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
  });

  it('X1 · 후보 행과 시각 시트 어디에도 소요시간 표기가 없다 (INV-3 · 선제 green)', async () => {
    await renderPage();
    fireEvent.press(screen.getByTestId('itinerary-place-add-p1'));
    await screen.findByTestId(SHEET);

    const texts = renderedTexts();
    // 모집단 긍정 짝 — 카드 이름과 시각 셀 숫자가 실제로 스캔 대상에 있다.
    expect(texts).toContain('감천문화마을');
    expect(texts).toContain('10');
    expect(texts.filter((text) => DURATION_TEXT.test(text))).toEqual([]);
  });
});

/**
 * TRIP-981 · B (#041) — 후보 목록을 여행 목적지로 좁힌다(`GET /places?region=<이름>`).
 *
 * 목적지는 `GET /trips/{tripId}` 의 `destinations[].region` 이다. 여행 조회가 끝날 때까지 장소 조회를
 * 미뤄 전국 목록이 먼저 보였다가 바뀌는 깜빡임을 막는다(01b Q2). 목적지가 2곳 이상이면 지역마다 조회해
 * 합친다(`useMultiRegionPlaces`, 01b Q2·브리프 Q3). 여행 조회가 실패하거나 목적지가 없으면 region 없이
 * 조회해 목록을 그린다(빈 화면·무한 로딩 금지).
 *
 * 칩·검색·무한 스크롤 무회귀(AC-B4)는 위 P1~P4·A2b·E1~E3 가 그대로 맡는다(기본 목적지 = 부산 1곳).
 *
 * 3동작 뼈대: 준비=여행 응답(목적지)·장소 핸들러 → 실행=렌더·칩·검색 → 단언=나간 /places 의 region·화면 카드.
 */
describe('TRIP-981 · B — 후보를 여행 목적지로 좁힌다 (region)', () => {
  function tripJson(
    destinations: { seq: number; region: string; nights: number }[]
  ) {
    return {
      tripId: 't1',
      title: '부산',
      startDate: '2026-06-10',
      endDate: '2026-06-12',
      party: 2,
      preferenceSnapshot: {},
      destinations,
      status: 'PLANNED',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    };
  }

  const TWO_REGIONS = [
    { seq: 1, region: '부산', nights: 1 },
    { seq: 2, region: '경주', nights: 1 },
  ];

  /** 부산 1곳 + 경주 2곳 — 지역마다 다른 장소가 와야 "합쳐졌다"를 잴 수 있다. */
  const REGIONAL_PLACES: Place[] = [
    makePlace('p1', '감천문화마을', '명소', 12),
    { ...makePlace('g1', '불국사', '명소', 40), region: '경주' },
    { ...makePlace('g2', '황리단길 카페', '카페', 9), region: '경주' },
  ];

  /** 서버처럼 region·category·q 로 거르는 장소 핸들러. */
  function serveRegionalPlaces(): void {
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const url = new URL(request.url);
        const region = url.searchParams.get('region');
        const category = url.searchParams.get('category');
        const q = url.searchParams.get('q');
        let result = REGIONAL_PLACES;
        if (region !== null) {
          result = result.filter((place) => place.region === region);
        }
        if (category !== null) {
          result = result.filter((place) => place.category === category);
        }
        if (q) result = result.filter((place) => place.nameKo.includes(q));
        return HttpResponse.json({ items: result, nextCursor: null });
      })
    );
  }

  function placeHits() {
    return hitsOf('GET', '/api/v1/places');
  }

  /** 나간 /places 요청들의 region 값(없으면 null). */
  function regionsOf(hits: { url: string }[]): (string | null)[] {
    return hits.map((hit) => new URL(hit.url).searchParams.get('region'));
  }

  function uniqueSorted(values: (string | null)[]): (string | null)[] {
    return [...new Set(values)].sort();
  }

  function tripHits() {
    return hitsOf('GET', '/api/v1/trips/t1');
  }

  it('🔴 B1a · 여행 조회가 끝날 때까지 장소를 조회하지 않고, 첫 요청부터 region=부산 이 실린다', async () => {
    // 준비 — 여행 응답을 손으로 풀 때까지 붙잡는다(목적지 부산).
    let releaseTrip!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTrip = resolve;
    });
    server.use(
      http.get(`${BASE}/trips/:tripId`, async () => {
        await gate;
        return HttpResponse.json(
          tripJson([{ seq: 1, region: '부산', nights: 2 }])
        );
      })
    );

    // 실행 — 렌더. 여행 요청이 나갔고(붙잡힘) 일정 요청도 나간 뒤 조금 더 흘린다.
    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
    await waitFor(() => expect(tripHits().length).toBeGreaterThanOrEqual(1));
    await waitFor(() =>
      expect(
        hitsOf('GET', '/api/v1/trips/t1/itinerary').length
      ).toBeGreaterThanOrEqual(1)
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // 단언 ① — 여행을 모르는 동안엔 전국 목록을 부르지 않는다.
    expect(placeHits()).toHaveLength(0);

    // 실행 — 여행 응답을 푼다.
    releaseTrip();
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-place-card-p1')).toBeOnTheScreen()
    );

    // 단언 ② — 나간 장소 요청은 전부 region=부산 이다.
    const regions = regionsOf(placeHits());
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions).toEqual(regions.map(() => '부산'));
  });

  it('🔴 B1b · 목적지가 부산 1곳이면 나간 장소 요청이 전부 region=부산 이다', async () => {
    await renderPage();

    expect(tripHits().length).toBeGreaterThanOrEqual(1);
    const regions = regionsOf(placeHits());
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions).toEqual(regions.map(() => '부산'));
  });

  it('🔴 B2a · 목적지가 부산·경주 2곳이면 지역마다 조회해 두 지역 장소를 함께 그린다', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripJson(TWO_REGIONS))
      )
    );
    serveRegionalPlaces();

    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-place-card-g1')).toBeOnTheScreen()
    );

    const regions = regionsOf(placeHits());
    expect(regions).not.toContain(null);
    expect(uniqueSorted(regions)).toEqual(['경주', '부산']);
    expect(screen.getByTestId('itinerary-place-card-p1')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-place-card-g2')).toBeOnTheScreen();
  });

  it('🔴 B2b · 다지역에서도 칩(category)·검색어(q)가 두 지역 요청 모두에 실린다', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripJson(TWO_REGIONS))
      )
    );
    serveRegionalPlaces();
    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-place-card-g1')).toBeOnTheScreen()
    );

    // 실행 ① — 카페 칩. 칩 뒤에 나간 요청만 본다.
    const beforeChip = placeHits().length;
    fireEvent.press(screen.getByTestId('itinerary-place-category-카페'));
    await waitFor(() =>
      expect(screen.queryByTestId('itinerary-place-card-p1')).toBeNull()
    );
    const chipHits = placeHits()
      .slice(beforeChip)
      .filter(
        (hit) => new URL(hit.url).searchParams.get('category') === '카페'
      );
    expect(uniqueSorted(regionsOf(chipHits))).toEqual(['경주', '부산']);

    // 실행 ② — 검색어 '황리'. 검색 뒤에 나간 요청만 본다.
    const beforeSearch = placeHits().length;
    fireEvent.changeText(screen.getByTestId('itinerary-place-search'), '황리');
    await waitFor(() =>
      expect(screen.queryByTestId('itinerary-place-card-g1')).toBeNull()
    );
    const searchHits = placeHits()
      .slice(beforeSearch)
      .filter((hit) => new URL(hit.url).searchParams.get('q') === '황리');
    expect(uniqueSorted(regionsOf(searchHits))).toEqual(['경주', '부산']);
    expect(screen.getByTestId('itinerary-place-card-g2')).toBeOnTheScreen();
  });

  it('🔴 B2c · 다지역 조회가 성공했는데 0건이면 "검색 결과가 없어요"가 뜬다 (INV-4)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripJson(TWO_REGIONS))
      ),
      http.get(`${BASE}/places`, () =>
        HttpResponse.json({ items: [], nextCursor: null })
      )
    );

    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });

    expect(
      await screen.findByTestId('itinerary-place-empty')
    ).toHaveTextContent('검색 결과가 없어요');
    // 앵커 — 지역별 조회가 실제로 나갔다(단일 경로의 0건 안내와 구분).
    expect(uniqueSorted(regionsOf(placeHits()))).toEqual(['경주', '부산']);
  });

  it('🔴 B3a · 여행 조회가 실패하면 region 없이 조회해 목록을 그린다 (폴백)', async () => {
    server.use(
      http.get(
        `${BASE}/trips/:tripId`,
        () => new HttpResponse(null, { status: 500 })
      )
    );

    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-place-card-p1')).toBeOnTheScreen()
    );

    // 앵커 — 여행을 읽으려 했다(원래 안 읽던 코드가 그대로 통과하지 않게).
    expect(tripHits().length).toBeGreaterThanOrEqual(1);
    const regions = regionsOf(placeHits());
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions).toEqual(regions.map(() => null));
  });

  it('🔴 B3b · 목적지가 0곳이면 region 없이 조회해 목록을 그린다 (폴백)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(tripJson([])))
    );

    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-place-card-p1')).toBeOnTheScreen()
    );

    expect(tripHits().length).toBeGreaterThanOrEqual(1);
    const regions = regionsOf(placeHits());
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions).toEqual(regions.map(() => null));
  });
});
