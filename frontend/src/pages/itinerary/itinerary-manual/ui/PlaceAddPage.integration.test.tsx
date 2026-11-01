import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Keyboard, Text } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useItineraryEditStore } from '@/features/edit-itinerary';
import { setAccessToken, clearAccessToken } from '@/shared/api/tokenManager';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItemSlotsItem,
  Place,
} from '@/shared/api/index.schemas';
import { coverFor } from '@/test-support/placeCoverFixtures';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';

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
 * TRIP-1009 추가 — 시각 시트 기본값 = 앞 장소 종료 시각부터 1시간(자정 넘김·폴백 규칙):
 *  - 🔴 **1009-B1·B2·B5** 앞 장소(insertAfter 있으면 그 슬롯, 없으면 마지막) 종료부터 1시간이 PUT 에 실린다.
 *  - 🟢선제 **1009-B3·B4** 앞 장소 없음·자정 넘겨 끝남이면 10:00–11:00 (무회귀).
 *
 * TRIP-1115 추가 — 카드 사이 "+" 가 보고 있는 날(라우트 `date`)에 들어간다(5-b 차단-1):
 *  - 🔴 **D1·D2** date 가 있으면 그 날 slots 에 splice·헤더 N일차·기본 시각 앞 장소도 그 날.
 *  - 🟢선제 **D3·D4** date 미전달·일정에 없는 날이면 첫 날(후방호환·폴백).
 *
 * TRIP-1233 추가 — 말미 「장소 추가」도 date 를 싣는다(보내는 쪽은 편집기 두 페이지):
 *  - 🟢선제 **D5** date 만 있고 insertAfter 가 없으면 그 날 말미에 붙는다.
 *  - 🔴 **B2a·B2b·B2c·B4** 다지역 여행의 후보는 담을 날의 지역만 조회한다(옛 두 지역 병합을 뒤집음).
 *
 * TRIP-1424 추가 — 장소 추가 결과 안내(즉시 저장은 그대로, 서버가 시각을 밀었으면 말한다):
 *  - 🔴 **N1~N5** PUT 요청·응답의 **추가한 자리** 슬롯 시작을 견줘 토스트 문구를 고른다(밀림·그대로·뒤 N곳·특정 실패).
 *  - 🔴 **N6·N7** 저장이 실패하면 "추가됨"이 되지 않고 시트 머리 아래 실패 안내가 뜬다(INV-4).
 *  - 🔴 **N9** 응답 전에 화면을 떠나도 성공이면 캐시가 바뀌고 토스트가 뜬다. **N10** 저장 중엔 다른 추가를 안 받는다.
 *  - 토스트는 모듈 싱글턴이라 리셋을 **파일 최상위** `afterEach` 에 건다(toastHarness 머리말).
 *
 * TRIP-1640 추가 — 한 화면에서 연달아 담기(삽입 자리·기본 시각이 저장에 성공한 만큼 밀린다):
 *  - 🔴 **S1·S2·S3** 담은 순서대로 선행 카드 뒤에 이어 붙고, 기본 시각은 앞서 담은 곳 종료부터이며, dirty 초안도 같다.
 *  - 🟢선제 **S4** 첫 저장이 실패하면 자리가 안 밀린다(시도가 아니라 성공을 센다).
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
  scoringMode: null,
  degradations: [],
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
    alternatives: [],
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
      const body = (await request.json()) as EditItineraryRequest;
      putBodies.push(body);
      // 서버는 저장한 일정을 그대로 돌려준다 — 페이지가 이 응답으로 일정 GET 캐시를 교체한다(TRIP-1348).
      // 날(date)을 보존해야 시트 헤더("N일차")가 안 흔들린다.
      return HttpResponse.json({
        ...ITINERARY_ENVELOPE,
        days: body.days.map((day) => ({ date: day.date, slots: [] })),
      });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  // TRIP-1424 — 토스트 스토어는 모듈 싱글턴이다. 기존 테스트의 추가 성공도 토스트를 띄우므로 describe 안이 아니라
  // 여기서 비운다 — 안 그러면 앞 테스트의 토스트가 뒤 "토스트가 뜬다" 단언을 거짓 green 으로 만든다(02a ★8).
  resetToast();
  // TRIP-1498 — 편집 스토어도 모듈 싱글턴이다. 낡은 초안을 심는 케이스(A8)가 뒤 케이스로 새지 않게 최상위에서 비운다.
  useItineraryEditStore.getState().reset();
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

describe('PH · 후보 행의 사진 칸 — 사진 없는 장소는 카테고리 생성 이미지 (사이클 20261022-place-category-covers)', () => {
  it('행마다 그 장소의 category·poiId 로 고른 그림이 같은 칸(itinerary-place-card-photo-{poiId})에 선다', async () => {
    await renderPage();

    // p1(명소·변형 2) · p2(야경·변형 3) — 행이 category 를 PlaceRowCard 에 안 넘기면 둘 다 폴백이다.
    expect(
      screen.getByTestId('itinerary-place-card-photo-p1').props.source
    ).toEqual([coverFor('명소', 'p1')]);
    expect(
      screen.getByTestId('itinerary-place-card-photo-p2').props.source
    ).toEqual([coverFor('야경', 'p2')]);
  });
});

describe('🔴 P2 · AC-5·TRIP-502 — 검색은 서버가 한다(q) — 로드된 페이지 한정이 아니다', () => {
  it('검색 "해" → q 로 서버를 다시 부르고, 서버가 거른 결과(p2)만 남는다', async () => {
    await renderPage();

    fireEvent.changeText(screen.getByTestId('itinerary-place-search'), '해');

    // 검색은 서버가 한다 — '해' 안 든 p1 은 사라지고, q 를 실은 새 요청이 나간다(로드된 페이지 한정 아님).
    // 검색어는 300ms 디바운스 뒤 서버로 나간다(TRIP-1348) — 기본 1초 대기는 CI 부하 속에서 모자라(재실행에도 3초에 실패) 8초로 두고 테스트 한도도 함께 늘린다.
    await waitFor(
      () => expect(screen.queryByTestId('itinerary-place-card-p1')).toBeNull(),
      { timeout: 8000 }
    );
    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(new URL(hits[hits.length - 1].url).searchParams.get('q')).toBe('해');

    // 서버가 거른 결과: '해' 든 p2 만 남고, 안 든 p3 는 없다.
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-place-card-p2')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('itinerary-place-card-p3')).toBeNull();
  }, 15000);
});

describe('TRIP-1348 · 검색어 디바운스 — 연속 입력이 키 입력마다 요청이 되지 않는다', () => {
  it('5글자를 연달아 입력하면 /places 는 첫 조회 + 마지막 검색어 1건뿐이다', async () => {
    await renderPage();
    const before = hitsOf('GET', '/api/v1/places').length;
    // 앵커 — 첫 조회 1건.
    expect(before).toBe(1);

    const input = screen.getByTestId('itinerary-place-search');
    for (const text of ['한', '한옥', '한옥마', '한옥마을', '한옥마을길']) {
      fireEvent.changeText(input, text);
      // 키 입력 간격(실제 타이핑은 100ms 안팎) — 이 간격이면 디바운스 없는 구현은 글자마다 요청이 나간다.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
    }

    await waitFor(() =>
      expect(
        hitsOf('GET', '/api/v1/places').some(
          (hit) => new URL(hit.url).searchParams.get('q') === '한옥마을길'
        )
      ).toBe(true)
    );
    // 중간 글자('한'·'한옥'…) 는 한 건도 나가지 않았다 — 첫 조회 + 최종 1건 = 2건 이하.
    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(
      hits.some((hit) => new URL(hit.url).searchParams.get('q') === '한옥')
    ).toBe(false);
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

  it('A6b · PUT 성공 → 일정 GET 캐시가 응답으로 교체되고 재조회는 없다 (누락 시 h19 에 영영 안 보임)', async () => {
    const client = makeClient();
    const setSpy = jest.spyOn(client, 'setQueryData');
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    renderPageWith(client);
    await screen.findByTestId('itinerary-place-add-p1');
    const getsBefore = hitsOf('GET', '/api/v1/trips/t1/itinerary').length;

    await addPlaceAndApply('p1');

    // onSuccess 의 setQueryData(일정 키, PUT 응답)를 관측 — 이 배선을 지우면 호출 0 으로 red(TRIP-1348).
    await waitFor(() =>
      expect(setSpy).toHaveBeenCalledWith(
        getGetTripsTripIdItineraryQueryKey('t1'),
        expect.objectContaining({ days: expect.any(Array) })
      )
    );
    // 무효화·재조회가 없다 — 같은 키 GET 이 늘지 않는다.
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: getGetTripsTripIdItineraryQueryKey('t1'),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hitsOf('GET', '/api/v1/trips/t1/itinerary')).toHaveLength(
      getsBefore
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

/**
 * TRIP-1115 5-b 차단-1 — 카드 사이 "+" 는 **보고 있는 날**의 번호다. 그래서 라우트 `date` 가 오면 그 날에
 * 끼워 넣는다. `date` 가 없거나 일정에 없는 날이면 지금처럼 첫 날(후방호환 — 말미 「장소 추가」는 `date` 를
 * 안 싣는다). 헤더 "N일차"와 시각 시트 기본값(앞 장소 종료부터 1시간)도 같은 날을 본다.
 *
 * 두 날의 슬롯 시각을 일부러 다르게 둔다 — 앞 장소를 첫 날에서 잘못 고르면 기본 시각이 달라져 드러난다.
 *
 * 3동작 뼈대: 준비=2일 일정 + 라우트 params(date·insertAfter) → 실행=일정 도착 뒤 p1 추가·그대로 적용 →
 * 단언=나간 PUT 의 날별 슬롯 순서·p1 시각, 헤더 문구.
 */
describe('🔴 D · TRIP-1115 — 라우트 date 가 있으면 그 날에 끼워 넣는다 (없거나 모르는 날이면 첫 날)', () => {
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';

  function timed(
    poiId: string,
    startAt: string,
    endAt: string
  ): ItineraryDaysItemSlotsItem {
    return { ...makeSlot(poiId), startAt, endAt };
  }

  beforeEach(() => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json({
          ...ITINERARY_ENVELOPE,
          days: [
            {
              date: DAY1,
              slots: [
                timed('sA', '08:00:00', '09:30:00'),
                timed('sB', '13:00:00', '14:00:00'),
              ],
            },
            {
              date: DAY2,
              slots: [
                timed('tA', '10:00:00', '11:00:00'),
                timed('tB', '15:00:00', '16:00:00'),
                timed('tC', '18:00:00', '19:00:00'),
              ],
            },
          ],
        })
      )
    );
  });

  /** 일정이 도착한 뒤 p1 을 담고 시트를 그대로 적용한다 → 나간 PUT 의 날별 poiId 와 p1 슬롯. */
  async function addP1AfterItinerary() {
    const client = makeClient();
    renderPageWith(client);
    // 일정 도착 전 "+ 추가"는 조용히 무시된다(W-2) — 캐시 성공 + 한 틱 뒤에 누른다(1009 선례).
    await waitFor(() =>
      expect(
        client.getQueryState(getGetTripsTripIdItineraryQueryKey('t1'))?.status
      ).toBe('success')
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await addPlaceAndApply('p1');

    await waitFor(() => expect(putBodies).toHaveLength(1));
    const idsOf = (date: string) =>
      putBodies[0].days
        .find((d) => d.date === date)
        ?.slots.map((slot) => slot.poiId);
    const p1 = putBodies[0].days
      .flatMap((d) => d.slots)
      .find((slot) => slot.poiId === 'p1');
    return { day1: idsOf(DAY1), day2: idsOf(DAY2), p1 };
  }

  it('🔴 D1 · date=2일차·insertAfter=1 → 2일차 [tA, tB, p1, tC] · 1일차 불변 · p1 은 tB 종료(16:00)부터 1시간', async () => {
    mockParams = { tripId: 't1', date: DAY2, insertAfter: '1' };

    const { day1, day2, p1 } = await addP1AfterItinerary();

    expect(day2).toEqual(['tA', 'tB', 'p1', 'tC']);
    expect(day1).toEqual(['sA', 'sB']);
    // 1일차 index 1(sB, 14:00 종료)을 앞 장소로 잘못 고르면 14:00–15:00 이 된다.
    expect({ startAt: p1?.startAt, endAt: p1?.endAt }).toEqual({
      startAt: '16:00:00',
      endAt: '17:00:00',
    });
  });

  it('🔴 D2 · date=2일차면 시트 헤더가 "장소 추가 · 2일차"다', async () => {
    mockParams = { tripId: 't1', date: DAY2 };
    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });

    expect(await screen.findByText('장소 추가 · 2일차')).toBeOnTheScreen();
  });

  // TRIP-1233 AC-1c — 말미 「장소 추가」도 이제 date 를 싣는다(insertAfter 없음). 받는 쪽은 이미 있었지만
  // date 만 있고 insertAfter 가 없는 조합을 잠근 케이스가 없었다(D1 은 insertAfter 동반, A7b 는 첫 날만).
  it('D5 · date=2일차·insertAfter 없음 → 2일차 말미 [tA, tB, tC, p1] · 1일차 불변 · p1 은 tC 종료(19:00)부터 1시간 · 헤더 2일차 (선제 green)', async () => {
    mockParams = { tripId: 't1', date: DAY2 };

    const { day1, day2, p1 } = await addP1AfterItinerary();

    expect(day2).toEqual(['tA', 'tB', 'tC', 'p1']);
    expect(day1).toEqual(['sA', 'sB']);
    expect({ startAt: p1?.startAt, endAt: p1?.endAt }).toEqual({
      startAt: '19:00:00',
      endAt: '20:00:00',
    });
    expect(screen.getByText('장소 추가 · 2일차')).toBeOnTheScreen();
  });

  it('D3 · date 미전달이면 첫 날에 넣는다 — 1일차 [sA, p1, sB] · 2일차 불변 (후방호환 · 선제 green)', async () => {
    mockParams = { tripId: 't1', insertAfter: '0' };

    const { day1, day2 } = await addP1AfterItinerary();

    expect(day1).toEqual(['sA', 'p1', 'sB']);
    expect(day2).toEqual(['tA', 'tB', 'tC']);
  });

  it('D4 · date 가 일정에 없는 날이면 첫 날에 넣고 헤더도 1일차다 (폴백 · 선제 green)', async () => {
    mockParams = { tripId: 't1', date: '2026-07-01', insertAfter: '0' };

    const { day1, day2 } = await addP1AfterItinerary();

    expect(day1).toEqual(['sA', 'p1', 'sB']);
    expect(day2).toEqual(['tA', 'tB', 'tC']);
    expect(screen.getByText('장소 추가 · 1일차')).toBeOnTheScreen();
  });
});

describe('🔴 A2 · TRIP-798 — 칩 8종·순서 + 전시→문화 (라벨≠전송값)', () => {
  it('A2a · 칩이 전체/맛집/명소/카페/전시/미술/야경/술집 8종·이 순서로 렌더된다', async () => {
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
      'itinerary-place-category-미술',
      'itinerary-place-category-야경',
      'itinerary-place-category-술집',
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

  it('SC1b · TRIP-1204 · 지도는 시트가 열린 채로도 손가락으로 움직인다(viewOnly=false)', async () => {
    await renderPage();

    expect(screen.getByTestId('map-root').props.viewOnly).toBe(false);
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
      await screen.findByTestId(
        'itinerary-place-empty',
        {},
        { timeout: 3000 } // 300ms 디바운스(TRIP-1348) 뒤에 조회가 나간다
      )
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
 * TRIP-1233 계약 변경(AC-3 · 01b 결정 2) — 목적지가 2곳 이상이면 지역을 합치지 않고 **담을 날의 지역만**
 * 조회한다(`regionForDay`, seq 순서로 박수만큼). 담을 날은 헤더 "N일차"와 같은 날이다 — 라우트 `date`
 * 가 일정에 있으면 그 날, 없거나 모르는 날이면 1일차(B2a·B2b·B2c 개정, B4 신설).
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

  /** TRIP-1233 — 부산(1박)·경주(1박) 여행 + 6/10·6/11 이틀 일정 + 지역별 장소. 2일차 = 경주. */
  function serveTwoDayTrip(): void {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripJson(TWO_REGIONS))
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json({
          ...ITINERARY_ENVELOPE,
          days: [
            { date: '2026-06-10', slots: [] },
            { date: '2026-06-11', slots: [] },
          ],
        })
      )
    );
    serveRegionalPlaces();
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

  // TRIP-1233 AC-3 — 다지역 여행의 후보는 **담을 날의 지역만**이다(01b 결정 2, `regionForDay`). 옛 B2a·B2b
  // 는 "두 지역을 합쳐 그린다"를 잠갔는데, 그 병합이 2일차(경주)를 채울 때 1일차(부산) 후보를 앞에 세웠다.
  it('🔴 B2a · 목적지가 부산(1박)·경주(1박)이고 date 가 없으면(1일차) 부산만 조회하고 경주 장소는 안 그린다', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(tripJson(TWO_REGIONS))
      )
    );
    serveRegionalPlaces();

    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-place-card-p1')).toBeOnTheScreen()
    );

    const regions = regionsOf(placeHits());
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions).toEqual(regions.map(() => '부산'));
    expect(screen.queryByTestId('itinerary-place-card-g1')).toBeNull();
  });

  it('🔴 B4 · 목적지가 부산(1박)·경주(1박)이고 date=2일차면 경주만 조회하고 부산 장소는 안 그린다 (AC-3)', async () => {
    serveTwoDayTrip();
    mockParams = { tripId: 't1', date: '2026-06-11' };

    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-place-card-g1')).toBeOnTheScreen()
    );

    // "만" — 첫 요청부터 경주다. 일정·날짜를 알기 전에 1일차(부산)나 지역 없이 먼저 부르면 여기서 red.
    const regions = regionsOf(placeHits());
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions).toEqual(regions.map(() => '경주'));
    expect(screen.getByTestId('itinerary-place-card-g2')).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-place-card-p1')).toBeNull();
    expect(screen.getByText('장소 추가 · 2일차')).toBeOnTheScreen();
  });

  it('🔴 B2b · 다지역에서도 칩(category)·검색어(q)가 그날 지역 요청에 실린다', async () => {
    serveTwoDayTrip();
    mockParams = { tripId: 't1', date: '2026-06-11' };
    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-place-card-g1')).toBeOnTheScreen()
    );

    // 실행 ① — 카페 칩. 칩 뒤에 나간 요청만 본다.
    const beforeChip = placeHits().length;
    fireEvent.press(screen.getByTestId('itinerary-place-category-카페'));
    await waitFor(() =>
      expect(screen.queryByTestId('itinerary-place-card-g1')).toBeNull()
    );
    const chipHits = placeHits()
      .slice(beforeChip)
      .filter(
        (hit) => new URL(hit.url).searchParams.get('category') === '카페'
      );
    expect(chipHits.length).toBeGreaterThanOrEqual(1);
    expect(uniqueSorted(regionsOf(chipHits))).toEqual(['경주']);

    // 실행 ② — 검색어 '황리'. 검색 뒤에 나간 요청만 본다.
    const beforeSearch = placeHits().length;
    fireEvent.changeText(screen.getByTestId('itinerary-place-search'), '황리');
    await waitFor(() =>
      expect(
        placeHits()
          .slice(beforeSearch)
          .some((hit) => new URL(hit.url).searchParams.get('q') === '황리')
      ).toBe(true)
    );
    const searchHits = placeHits()
      .slice(beforeSearch)
      .filter((hit) => new URL(hit.url).searchParams.get('q') === '황리');
    expect(uniqueSorted(regionsOf(searchHits))).toEqual(['경주']);
    expect(
      await screen.findByTestId('itinerary-place-card-g2')
    ).toBeOnTheScreen();
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
    // 앵커 — 그날(1일차) 지역으로 조회가 실제로 나갔다(TRIP-1233 — 옛 앵커는 두 지역 병합이었다).
    expect(uniqueSorted(regionsOf(placeHits()))).toEqual(['부산']);
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

/**
 * TRIP-1009 · B (#080) — 새 장소 시각 시트의 기본값 = 앞 장소가 끝나는 시각(간격 0, 길이 1시간).
 *
 * 앞 장소는 `insertAfter` 가 있으면 그 index 슬롯, 없으면 담을 일자(`days[0]`)의 마지막 슬롯이다.
 * 앞 장소가 없거나 자정을 넘겨 끝나면 옛 기본값 10:00–11:00 이다(01b Q2-a). 23시 이후 시작이면 종료가
 * 자정을 넘기고, 그 `endsNextDay` 는 시트가 유도한다(01b Q2-b). 이 페이지는 직접 짜기·일정 편집·AI 추천안
 * 장소 검색 세 입구가 같이 쓰므로 여기 한 곳이 세 입구를 덮는다.
 *
 * 기본값은 시트 셀이 아니라 **셀을 건드리지 않고 [적용]했을 때 나간 PUT 의 새 슬롯**으로 잰다.
 * 한 테스트에 추가는 한 번 — 연속 추가는 재조회 경합이라 앞 장소를 픽스처에 미리 심는다.
 *
 * 3동작 뼈대: 준비=일정 GET 의 days[0].slots(+insertAfter) → 실행=일정 도착 뒤 p1 추가·그대로 적용 →
 * 단언=PUT 의 p1 슬롯 startAt·endAt·endsNextDay.
 */
describe('TRIP-1009 · B — 새 장소 기본 시각은 앞 장소가 끝나는 시각부터 1시간', () => {
  function timedSlot(
    poiId: string,
    startAt: string,
    endAt: string,
    endsNextDay = false
  ): ItineraryDaysItemSlotsItem {
    return { ...makeSlot(poiId), startAt, endAt, endsNextDay };
  }

  function serveDay(slots: ItineraryDaysItemSlotsItem[]): void {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json({
          ...ITINERARY_ENVELOPE,
          days: [{ date: '2026-06-10', slots }],
        })
      )
    );
  }

  /** 일정이 도착한 뒤 p1 을 담고 시트를 그대로 적용한다 → 나간 PUT 의 그 날 슬롯들과 p1 슬롯. */
  async function addP1WithDefaultTime() {
    const client = makeClient();
    renderPageWith(client);
    // 일정 도착 전 "+ 추가"는 조용히 무시된다(W-2) — 캐시 성공 + 한 틱 뒤에 누른다(M1 선례).
    await waitFor(() =>
      expect(
        client.getQueryState(getGetTripsTripIdItineraryQueryKey('t1'))?.status
      ).toBe('success')
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await addPlaceAndApply('p1');

    await waitFor(() => expect(putBodies).toHaveLength(1));
    const day = putBodies[0].days.find((d) => d.date === '2026-06-10');
    const added = day?.slots.find((slot) => slot.poiId === 'p1');
    return {
      slots: day?.slots ?? [],
      time: {
        startAt: added?.startAt,
        endAt: added?.endAt,
        endsNextDay: added?.endsNextDay,
      },
    };
  }

  it('🔴 1009-B1 · 앞 장소가 10:00–11:00 이면 새 장소는 11:00–12:00 이다 (겹치지 않는다)', async () => {
    serveDay([timedSlot('sA', '10:00:00', '11:00:00')]);

    const { time } = await addP1WithDefaultTime();

    expect(time).toEqual({
      startAt: '11:00:00',
      endAt: '12:00:00',
      endsNextDay: false,
    });
  });

  it('🔴 1009-B2 · 카드 사이 + 면 마지막 장소가 아니라 바로 앞 장소(index 0, 09:30 종료)를 기준으로 삼는다', async () => {
    mockParams = { tripId: 't1', insertAfter: '0' };
    serveDay([
      timedSlot('sA', '08:00:00', '09:30:00'),
      timedSlot('sB', '13:00:00', '14:00:00'),
    ]);

    const { slots, time } = await addP1WithDefaultTime();

    // 앵커 — 선행 index 0 다음 자리에 들어갔다(기준 슬롯이 sA 인 전제).
    expect(slots[1]?.poiId).toBe('p1');
    expect(time).toEqual({
      startAt: '09:30:00',
      endAt: '10:30:00',
      endsNextDay: false,
    });
  });

  it('1009-B6 · 말미 추가(insertAfter 없음)는 첫 장소가 아니라 마지막 장소(14:00 종료)를 기준으로 삼는다 (03b 경고-1)', async () => {
    // 준비 — 슬롯이 2개라야 "첫 번째 = 마지막"이 갈린다(B1·B4·B5 는 1개, B3 은 0개).
    serveDay([
      timedSlot('sA', '08:00:00', '09:30:00'),
      timedSlot('sB', '13:00:00', '14:00:00'),
    ]);

    const { slots, time } = await addP1WithDefaultTime();

    // 앵커 — 말미에 붙었다.
    expect(slots[slots.length - 1]?.poiId).toBe('p1');
    expect(time).toEqual({
      startAt: '14:00:00',
      endAt: '15:00:00',
      endsNextDay: false,
    });
  });

  it('1009-B3 · 빈 일자의 첫 장소는 10:00–11:00 이다 (무회귀 · 선제 green)', async () => {
    serveDay([]);

    const { time } = await addP1WithDefaultTime();

    expect(time).toEqual({
      startAt: '10:00:00',
      endAt: '11:00:00',
      endsNextDay: false,
    });
  });

  it('1009-B4 · 앞 장소가 자정을 넘겨(01:00 익일) 끝나면 10:00–11:00 으로 돌아간다 (폴백 · 선제 green)', async () => {
    serveDay([timedSlot('sA', '23:00:00', '01:00:00', true)]);

    const { time } = await addP1WithDefaultTime();

    expect(time).toEqual({
      startAt: '10:00:00',
      endAt: '11:00:00',
      endsNextDay: false,
    });
  });

  it('🔴 1009-B5 · 앞 장소가 23:30 에 끝나면 23:30–00:30 이고 자정 넘김(endsNextDay)으로 저장된다', async () => {
    serveDay([timedSlot('sA', '22:30:00', '23:30:00')]);

    const { time } = await addP1WithDefaultTime();

    expect(time).toEqual({
      startAt: '23:30:00',
      endAt: '00:30:00',
      endsNextDay: true,
    });
  });
});

/**
 * TRIP-1215 · QA Q-29 재현 지점 — 장소 추가 시트에서 시작 11:00 · 종료 08:00 을 넣으면 그대로 PUT 되던 것.
 *
 * 이 페이지는 onApply 를 받자마자 시트를 닫고(동기) 재판정 없이 바로 PUT 한다(02a ★3) — 시트가 유일한 문이다.
 * 그래서 [적용] 뒤 시트가 남아 있고 PUT 이 0건이면 막힌 것이다. 고치면 같은 시트에서 바로 적용된다.
 *
 * 3동작 뼈대: 준비=빈 일자(기본 10:00–11:00) → 실행=p1 추가·휠·[적용] → 단언=문구·시트 잔존·PUT 바디.
 */
describe('장소 추가 시트 — 종료가 시작보다 이르면 막는다', () => {
  const SHEET = 'itinerary-edit-time-sheet';
  const t = (suffix: string): string => `itinerary-edit-time-${suffix}`;

  it('🔴 QA1 · 11:00–08:00 은 [적용]해도 PUT 이 안 나가고, 종료를 20:00 으로 고치면 그 값으로 담긴다', async () => {
    const client = makeClient();
    renderPageWith(client);
    // 일정 도착 전 "+ 추가"는 조용히 무시된다(W-2) — 캐시 성공 + 한 틱 뒤에 누른다(1009 선례).
    await waitFor(() =>
      expect(
        client.getQueryState(getGetTripsTripIdItineraryQueryKey('t1'))?.status
      ).toBe('success')
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    fireEvent.press(await screen.findByTestId('itinerary-place-add-p1'));
    await screen.findByTestId(SHEET);
    // 기본 10:00–11:00 → 시작 11 → 11:00 · 종료 08 · 00 → 08:00(TRIP-1437 — 24시간 zero-pad 시 셀).
    ['wheel-h-11', 'seg-end', 'wheel-h-08', 'wheel-m-00'].forEach((suffix) =>
      fireEvent.press(screen.getByTestId(t(suffix)))
    );

    expect(screen.getByTestId(t('error'))).toHaveTextContent(
      '종료 시각은 시작보다 늦어야 해요'
    );
    fireEvent.press(screen.getByTestId(t('apply')));
    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
    expect(putBodies).toHaveLength(0);

    fireEvent.press(screen.getByTestId(t('wheel-h-20'))); // 08:00 → 20:00
    expect(screen.queryByTestId(t('error'))).toBeNull();
    fireEvent.press(screen.getByTestId(t('apply')));

    await waitFor(() => expect(putBodies).toHaveLength(1));
    const day = putBodies[0].days.find((d) => d.date === '2026-06-10');
    const added = day?.slots.find((slot) => slot.poiId === 'p1');
    expect({
      startAt: added?.startAt,
      endAt: added?.endAt,
      endsNextDay: added?.endsNextDay,
    }).toEqual({ startAt: '11:00:00', endAt: '20:00:00', endsNextDay: false });
  });
});

/**
 * TRIP-1424 — 장소 추가 결과 안내. 시각 시트 [적용]은 지금처럼 곧장 저장(PUT)하고, 그 결과를 사용자에게 말한다.
 *
 * 무엇을 보장하나:
 *  - 🔴 N1~N5 서버가 추가한 곳의 시작을 밀었으면(이동 시간 반영) 토스트가 **응답 시각 그대로** 말한다(INV-2).
 *    비교 대상은 (날짜, poiId) 검색이 아니라 **요청에서 끼운 자리**의 슬롯이다(같은 날 같은 장소가 둘이어도 N4).
 *    뒤 슬롯이 밀린 수도 덧붙이고(결정 3=A, N3), 자리를 못 집으면 시각을 말하지 않는다(N5).
 *  - 🔴 N6·N7 저장이 실패하면 그 행이 "추가됨"이 되지 않고, 시트 머리 아래에 실패 안내가 뜬다(INV-4 · 01b Q7).
 *  - 🟢 N8 성공이면 "추가됨"(성공 뒤로 옮겨도 남아야 하는 짝).
 *  - 🔴 N9 응답 전에 이 화면을 떠나도 성공이면 일정 캐시가 바뀌고 토스트가 뜬다(01b Q2 — 호출별 콜백은 언마운트 뒤 안 불린다).
 *  - 🔴 N10 저장 중엔 다른 행 「+ 추가」를 받지 않고, 끝난 뒤 둘째 추가는 첫 추가를 잃지 않는다(01b Q3).
 *
 * 장치(02a ★):
 *  - PUT 핸들러는 **요청을 서버 일정 모양으로 되돌려 주고 `startAt` 만 덮어쓴다**(echo) — 파일 최상위 기본 PUT 은 그날
 *    슬롯을 비워 돌려줘 "특정 실패" 길(N5)만 밟는다(★9).
 *  - 17:14 는 앞 장소 16:00–17:00(기본 제안 17:00–18:00) 에서 분 셀 14 를 눌러 만든다 — 종료 18:00 이 시작보다 늦어
 *    [적용]이 막히지 않는다(★11, TRIP-1437 셀 testID).
 *  - 트리는 QueryClient + 토스트 호스트 + **편집기 대역**(같은 일정 키를 구독하는 형제) + 페이지다. 실기에선 장소 추가
 *    아래에 편집기가 그 키를 들고 있다 — 대역이 없으면 페이지를 뺀 순간 캐시가 지워져(gcTime 0) "떠나도 캐시가 바뀐다"를
 *    잴 수 없다(02a §5 V4). 떠남은 페이지만 트리에서 빼서 재현한다(★14).
 *
 * 3동작 뼈대: 준비 = 그날 슬롯 · 응답 덮어쓰기(· 문) → 실행 = 「+ 추가」 → 시각 → [적용] (→ 떠남 · 문 열기) →
 * 단언 = 나간 PUT 바디(앵커) · 토스트 문구 · 행 상태 · 실패 안내 · 캐시.
 */
describe('TRIP-1424 · 장소 추가 결과 안내 — 토스트 · 실패 안내 · 저장 중 잠금', () => {
  const D1 = '2026-06-10';
  const D2 = '2026-06-11';
  const TOAST = 'itinerary-place-added-toast';
  const ERROR = 'itinerary-place-add-error';
  const ERROR_TEXT = '장소를 담지 못했어요. 잠시 후 다시 시도해 주세요';
  const SHEET = 'itinerary-edit-time-sheet';
  const EDITOR = 'editor-itinerary-poi-ids';
  const DURATION_TEXT = /\d+\s*(분|초|시간)|소요/;
  /**
   * 한 테스트 한도 — 통합 버킷의 `findBy*` 기본 대기(5초, integrationSetup)와 jest 테스트 한도(5초)가 같아서, 지금처럼
   * 토스트·실패 안내가 아직 없으면 "요소를 못 찾음" 대신 "테스트 시간 초과"로 죽어 red 이유가 가려진다. 한도를 넉넉히 둔다.
   */
  const SLOW = 15000;

  function slotAt(
    poiId: string,
    startAt: string,
    endAt: string
  ): ItineraryDaysItemSlotsItem {
    return { ...makeSlot(poiId), startAt, endAt };
  }

  function serveDays(
    days: { date: string; slots: ItineraryDaysItemSlotsItem[] }[]
  ): void {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json({ ...ITINERARY_ENVELOPE, days })
      )
    );
  }

  /**
   * 요청 바디를 서버 일정 모양으로 되돌려 준다 — `shifts[날짜][자리]` 가 있으면 그 슬롯의 `startAt` 만 바꾼다
   * (서버의 TIME_SHIFT_ONLY repair 흉내 — 장소·순서는 요청 그대로, BR-U3-13·14 §3 개정).
   */
  function echo(
    body: EditItineraryRequest,
    shifts: Record<string, Record<number, string>> = {}
  ): Itinerary {
    return {
      ...ITINERARY_ENVELOPE,
      days: body.days.map((day) => ({
        date: day.date,
        slots: day.slots.map((one, index) => ({
          ...one,
          startAt: shifts[day.date]?.[index] ?? one.startAt,
          endsNextDay: one.endsNextDay ?? false,
          hasViolation: false,
          tags: [],
          alternatives: [],
        })),
      })),
    } as Itinerary;
  }

  /** PUT 응답을 케이스가 정한다. 기본 = 그대로 되돌려 줌(밀림 없음). */
  let respond: (body: EditItineraryRequest) => Response;
  /** PUT 을 붙잡는 문. null 이면 곧장 응답한다. */
  let putGate: Promise<void> | null = null;
  let openPutGate: (() => void) | null = null;

  function holdPut(): void {
    putGate = new Promise<void>((resolve) => {
      openPutGate = resolve;
    });
  }

  beforeEach(() => {
    respond = (body) => HttpResponse.json(echo(body));
    putGate = null;
    openPutGate = null;
    server.use(
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        const body = (await request.json()) as EditItineraryRequest;
        putBodies.push(body);
        if (putGate !== null) await putGate;
        return respond(body);
      })
    );
  });

  // 문을 안 열고 끝나면 붙잡힌 요청이 열린 핸들로 남는다 — 이 describe 의 afterEach 가 최상위 것보다 먼저 돈다.
  afterEach(() => {
    act(() => {
      openPutGate?.();
    });
  });

  /** 편집기 대역 — 장소 추가 아래에서 같은 일정 키를 구독하는 화면. 그날 poiId 를 글자로 드러낸다. */
  function EditorStandIn(): ReactNode {
    const query = useGetTripsTripIdItinerary('t1');
    const ids = (query.data?.days?.[0]?.slots ?? []).map((one) => one.poiId);
    return <Text testID={EDITOR}>{ids.join(',')}</Text>;
  }

  /** QueryClient + 토스트 호스트 + 편집기 대역 + 페이지. `leave()` = 페이지만 트리에서 뺀다(호스트·대역은 남음). */
  function renderTree() {
    const client = makeClient();
    function Tree({ show }: { show: boolean }) {
      return (
        <QueryClientProvider client={client}>
          <WithToastHost>
            <EditorStandIn />
            {show ? <PlaceAddPage tripId="t1" /> : null}
          </WithToastHost>
        </QueryClientProvider>
      );
    }
    const view = render(<Tree show />);
    return {
      client,
      leave: () => view.rerender(<Tree show={false} />),
      // 떠났던 페이지를 **새로** 마운트한다 — useRef·useState 가 모두 새것인 새 인스턴스(TRIP-1498 b).
      reenter: () => view.rerender(<Tree show />),
    };
  }

  /** 일정 도착 전 「+ 추가」는 조용히 무시된다(W-2) — 캐시 성공 + 한 틱 뒤에 누른다(1009 선례). */
  async function ready(client: QueryClient): Promise<void> {
    await waitFor(() =>
      expect(
        client.getQueryState(getGetTripsTripIdItineraryQueryKey('t1'))?.status
      ).toBe('success')
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** 「+ 추가」 → 시트 → (시작 17:14) → [적용]. */
  async function add(poiId: string, at1714 = false): Promise<void> {
    fireEvent.press(await screen.findByTestId(`itinerary-place-add-${poiId}`));
    await screen.findByTestId(SHEET);
    if (at1714) {
      fireEvent.press(screen.getByTestId('itinerary-edit-time-wheel-h-17'));
      fireEvent.press(screen.getByTestId('itinerary-edit-time-wheel-m-14'));
    }
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));
  }

  /** 나간 PUT 의 그날 슬롯을 `[poiId, startAt]` 쌍으로. */
  function sent(index: number, date: string): [string, string][] {
    const day = putBodies[index]?.days.find((one) => one.date === date);
    return (day?.slots ?? []).map((one) => [one.poiId, one.startAt]);
  }

  /** 화면에 그려진 글자 전부(호스트 노드만) — 소요시간 부정 검사의 모집단. */
  function renderedTexts(): string[] {
    const out: string[] = [];
    screen.root
      .findAll((node) => typeof node.type === 'string')
      .forEach((node) => {
        const children = node.props?.children as unknown;
        const list = Array.isArray(children) ? children : [children];
        list.forEach((child) => {
          if (typeof child === 'string') out.push(child);
        });
      });
    return out;
  }

  it(
    '🔴 N1 · AC-10·20 — 17:14 로 담았는데 서버가 17:40 으로 밀었으면 토스트가 응답 시각으로 말한다',
    async () => {
      serveDays([{ date: D1, slots: [slotAt('sA', '16:00:00', '17:00:00')] }]);
      respond = (body) =>
        HttpResponse.json(echo(body, { [D1]: { 1: '17:40:00' } }));
      const { client } = renderTree();
      await ready(client);
      // 앵커 — 담기 전엔 토스트가 없다(앞 테스트의 토스트가 새지 않았다, 02a ★8).
      expect(screen.queryByTestId(TOAST)).toBeNull();

      await add('p1', true);

      await waitFor(() => expect(putBodies).toHaveLength(1));
      // 앵커 — 요청은 사용자가 고른 17:14 다(밀린 것은 서버 응답).
      expect(sent(0, D1)).toEqual([
        ['sA', '16:00:00'],
        ['p1', '17:14:00'],
      ]);
      expect(await screen.findByTestId(TOAST)).toHaveTextContent(
        '추가했어요 · 이동 시간을 반영해 17:40으로 맞췄어요'
      );
      // 모집단 긍정 짝 — 토스트 문구가 실제로 스캔 대상에 있다. 그리고 소요시간 꼴은 하나도 없다(INV-3).
      const texts = renderedTexts();
      expect(texts).toContain(
        '추가했어요 · 이동 시간을 반영해 17:40으로 맞췄어요'
      );
      expect(texts.filter((text) => DURATION_TEXT.test(text))).toEqual([]);
    },
    SLOW
  );

  it(
    '🔴 N2 · AC-11 — 응답 시작이 고른 시각과 같으면 "일정에 바로 저장됐어요"',
    async () => {
      serveDays([{ date: D1, slots: [slotAt('sA', '16:00:00', '17:00:00')] }]);
      const { client } = renderTree();
      await ready(client);

      await add('p1', true);

      await waitFor(() => expect(putBodies).toHaveLength(1));
      expect(await screen.findByTestId(TOAST)).toHaveTextContent(
        '추가했어요 · 일정에 바로 저장됐어요'
      );
    },
    SLOW
  );

  it(
    '🔴 N3 · AC-12 — 추가한 자리 뒤에서 밀린 곳만 센다 (앞 슬롯·다른 날은 안 센다)',
    async () => {
      mockParams = { tripId: 't1', insertAfter: '0' };
      serveDays([
        {
          date: D1,
          slots: [
            slotAt('sA', '16:00:00', '17:00:00'),
            slotAt('sB', '18:00:00', '19:00:00'),
            slotAt('sC', '20:00:00', '21:00:00'),
          ],
        },
        { date: D2, slots: [slotAt('tA', '10:00:00', '11:00:00')] },
      ]);
      // 앞(sA)·다른 날(tA)도 일부러 바꾼다 — 이걸 세면 "뒤 3곳"이 된다. 뒤 둘 중 sC 는 그대로 — 뒤 전부를 세면 "2곳"(02a ★13).
      respond = (body) =>
        HttpResponse.json(
          echo(body, {
            [D1]: { 0: '16:10:00', 1: '17:40:00', 2: '18:30:00' },
            [D2]: { 0: '10:30:00' },
          })
        );
      const { client } = renderTree();
      await ready(client);

      await add('p1', true);

      await waitFor(() => expect(putBodies).toHaveLength(1));
      // 앵커 — 선행 index 0 다음 자리(index 1)에 끼웠다.
      expect(sent(0, D1)).toEqual([
        ['sA', '16:00:00'],
        ['p1', '17:14:00'],
        ['sB', '18:00:00'],
        ['sC', '20:00:00'],
      ]);
      expect(await screen.findByTestId(TOAST)).toHaveTextContent(
        '추가했어요 · 이동 시간을 반영해 17:40으로 맞췄어요 · 뒤 1곳도 시간이 밀렸어요'
      );
    },
    SLOW
  );

  it(
    '🔴 N4 · AC-13 — 같은 날 같은 장소가 이미 있어도 추가한 자리(말미)의 시각으로 말한다',
    async () => {
      serveDays([
        {
          date: D1,
          slots: [
            slotAt('sA', '09:00:00', '10:00:00'),
            slotAt('p1', '12:00:00', '13:00:00'),
            slotAt('sB', '16:00:00', '17:00:00'),
          ],
        },
      ]);
      // 먼저 있던 p1(12:00)은 그대로, 말미에 끼운 p1 만 17:40 — (날짜, poiId) 첫 일치로 찾으면 "저장됐어요"가 된다(02a ★12).
      respond = (body) =>
        HttpResponse.json(echo(body, { [D1]: { 3: '17:40:00' } }));
      const { client } = renderTree();
      await ready(client);

      await add('p1', true);

      await waitFor(() => expect(putBodies).toHaveLength(1));
      expect(sent(0, D1).map(([poiId]) => poiId)).toEqual([
        'sA',
        'p1',
        'sB',
        'p1',
      ]);
      expect(await screen.findByTestId(TOAST)).toHaveTextContent(
        '추가했어요 · 이동 시간을 반영해 17:40으로 맞췄어요'
      );
    },
    SLOW
  );

  it(
    '🔴 N5 · AC-14 — 응답에서 추가한 자리를 못 집으면 시각을 말하지 않는다',
    async () => {
      serveDays([{ date: D1, slots: [slotAt('sA', '16:00:00', '17:00:00')] }]);
      respond = (body) =>
        HttpResponse.json({
          ...ITINERARY_ENVELOPE,
          days: body.days.map((day) => ({ date: day.date, slots: [] })),
        });
      const { client } = renderTree();
      await ready(client);

      await add('p1', true);

      await waitFor(() => expect(putBodies).toHaveLength(1));
      expect(await screen.findByTestId(TOAST)).toHaveTextContent(
        '추가했어요 · 일정에 바로 저장됐어요'
      );
    },
    SLOW
  );

  it.each<[string, () => Response]>([
    [
      '409(확정된 일정)',
      () =>
        HttpResponse.json(
          {
            error: {
              code: 'ITINERARY_CONFIRMED',
              message: '확정된 일정이에요',
            },
          },
          { status: 409 }
        ),
    ],
    [
      '500',
      () => HttpResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 }),
    ],
    ['네트워크 끊김', () => HttpResponse.error()],
  ])(
    '🔴 N6 · AC-15 — 저장이 %s 로 실패하면 "추가됨"이 되지 않고 실패 안내가 뜬다 · 토스트 0',
    async (_name, failure) => {
      respond = () => failure();
      const { client } = renderTree();
      await ready(client);

      await add('p1');

      await waitFor(() => expect(putBodies).toHaveLength(1));
      expect(await screen.findByTestId(ERROR)).toHaveTextContent(ERROR_TEXT);
      expect(screen.getByTestId('itinerary-place-add-p1')).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-place-added-p1')).toBeNull();
      expect(screen.queryByTestId(TOAST)).toBeNull();
    },
    SLOW
  );

  it(
    '🔴 N7 · AC-15 — 실패 안내는 다음 추가가 성공하면 사라진다',
    async () => {
      let calls = 0;
      respond = (body) => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 })
          : HttpResponse.json(echo(body));
      };
      const { client } = renderTree();
      await ready(client);
      await add('p1');
      // 앵커 — 첫 추가는 실패 안내까지 갔다.
      await screen.findByTestId(ERROR);

      await add('p2');

      await waitFor(() => expect(putBodies).toHaveLength(2));
      await screen.findByTestId(TOAST);
      expect(screen.queryByTestId(ERROR)).toBeNull();
      expect(screen.getByTestId('itinerary-place-added-p2')).toBeOnTheScreen();
    },
    SLOW
  );

  it(
    '🟢 N8 · AC-16 — 저장이 성공하면 그 행이 "추가됨"이 된다 (선제 green)',
    async () => {
      const { client } = renderTree();
      await ready(client);

      await add('p1');

      expect(
        await screen.findByTestId('itinerary-place-added-p1')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-place-add-p1')).toBeNull();
    },
    SLOW
  );

  it(
    '🔴 N9 · AC-17 — 응답 전에 화면을 떠나도 성공이면 편집기 캐시가 바뀌고 토스트가 뜬다',
    async () => {
      serveDays([{ date: D1, slots: [slotAt('sA', '16:00:00', '17:00:00')] }]);
      respond = (body) =>
        HttpResponse.json(echo(body, { [D1]: { 1: '17:40:00' } }));
      holdPut();
      const { client, leave } = renderTree();
      await ready(client);
      // 앵커 — 편집기 대역이 지금 일정(sA 하나)을 본다.
      expect(screen.getByTestId(EDITOR)).toHaveTextContent('sA');

      await add('p1', true);
      // 앵커 — PUT 이 서버에 도착했다(응답만 붙잡혀 있다). 이 틈이 "응답 전 이탈"이다(02a ★14).
      await waitFor(() => expect(putBodies).toHaveLength(1));

      leave();
      expect(screen.queryByTestId('itinerary-place-list')).toBeNull();
      await act(async () => {
        openPutGate?.();
      });

      await waitFor(() =>
        expect(screen.getByTestId(EDITOR)).toHaveTextContent('sA,p1')
      );
      expect(await screen.findByTestId(TOAST)).toHaveTextContent(
        '추가했어요 · 이동 시간을 반영해 17:40으로 맞췄어요'
      );
    },
    SLOW
  );

  it('🔴 N10 · AC-18 — 저장 중엔 다른 행 「+ 추가」가 시트를 열지 않고, 끝난 뒤 둘째 추가는 첫 추가를 싣는다', async () => {
    holdPut();
    const { client } = renderTree();
    await ready(client);

    await add('p1');
    await waitFor(() => expect(putBodies).toHaveLength(1));

    // 실행 — 첫 저장 응답을 기다리는 동안 다른 행을 누른다.
    fireEvent.press(screen.getByTestId('itinerary-place-add-p2'));
    expect(screen.queryByTestId(SHEET)).toBeNull();

    await act(async () => {
      openPutGate?.();
    });
    // 앵커 — 첫 추가가 끝났다.
    await screen.findByTestId('itinerary-place-added-p1');

    await add('p2');

    await waitFor(() => expect(putBodies).toHaveLength(2));
    // 둘째 PUT 은 첫 응답으로 바뀐 캐시에서 만든다 — p1 을 잃지 않았다(02a ★15).
    expect(sent(1, D1).map(([poiId]) => poiId)).toEqual(['p1', 'p2']);
  });

  /**
   * TRIP-1498 (b) — 저장 잠금은 화면 인스턴스가 아니라 **진행 중인 저장**에 걸린다.
   * N10 은 한 인스턴스 안만 재므로, 응답 전에 화면을 떠났다 새 인스턴스로 다시 들어온 경우(= 앞 저장의 응답을
   * 모르는 새 화면)를 따로 잰다. 잠금이 인스턴스 소유면 새 화면은 앞 저장이 캐시에 안 들어온 일정으로 둘째 PUT 을
   * 만들어 서버가 둘째를 마지막에 받는 순서에서 첫 장소가 지워진다(갱신 소실) — 그런데 첫 장소의 토스트는 이미
   * "추가했어요" 라고 말했다(INV-4).
   * 3동작: 준비 = 첫 PUT 응답을 붙잡는 문 → 실행 = p1 [적용] → PUT 도착 → 떠남 → 새 인스턴스에서 p2 [+ 추가] →
   * 문 열기 → p2 [추가]·[적용] → 단언 = 붙잡힌 동안 시트·둘째 PUT 없음 · 둘째 PUT 이 p1 을 싣는다.
   */
  it(
    '🔴 B1 · AC-b1 — 앞 저장의 응답 전에 떠났다 새 화면으로 들어와도 다른 장소 추가를 받지 않고, 끝난 뒤 둘째 PUT 은 첫 장소를 싣는다',
    async () => {
      holdPut();
      const { client, leave, reenter } = renderTree();
      await ready(client);
      await add('p1');
      // 앵커 — 첫 PUT 이 서버에 도착했다(응답만 붙잡힘).
      await waitFor(() => expect(putBodies).toHaveLength(1));

      // 실행 — 떠났다가 새 인스턴스로 다시 들어와 다른 행을 누른다.
      leave();
      expect(screen.queryByTestId('itinerary-place-list')).toBeNull();
      reenter();
      fireEvent.press(await screen.findByTestId('itinerary-place-add-p2'));

      // 단언 1 — 앞 저장이 안 끝났으니 시트가 안 열리고 둘째 PUT 도 없다.
      expect(screen.queryByTestId(SHEET)).toBeNull();
      expect(putBodies).toHaveLength(1);

      // 실행 2 — 앞 저장이 끝난다(편집기 대역이 캐시의 p1 을 본다) → 이제 p2 를 담는다.
      await act(async () => {
        openPutGate?.();
      });
      await waitFor(() =>
        expect(screen.getByTestId(EDITOR)).toHaveTextContent('p1')
      );
      await add('p2');

      // 단언 2 — 둘째 PUT 은 첫 응답이 들어간 캐시에서 만든다: p1 이 지워지지 않는다.
      await waitFor(() => expect(putBodies).toHaveLength(2));
      expect(sent(1, D1).map(([poiId]) => poiId)).toEqual(['p1', 'p2']);
    },
    SLOW
  );

  /**
   * TRIP-1498 (a) · AC-a8 — 편집기 없이 장소 추가만 단독으로 열리는 진입(후보 시트·같이 짜기)에서도 저장은
   * 서버 캐시 기준이다. 편집 스토어는 앱 수명 싱글턴이라 이전 세션의 초안이 낡은 채 남아 있을 수 있다 —
   * 그 낡은 초안(서버에 없는 ghost)을 신뢰해 PUT 을 만들면 없는 장소가 저장된다.
   */
  it(
    'A8 · AC-a8 — 낡은 편집 초안이 스토어에 남아 있어도 PUT 은 서버 캐시 기준이고 토스트는 기존 문구 그대로다 (선제 green)',
    async () => {
      serveDays([{ date: D1, slots: [slotAt('sA', '16:00:00', '17:00:00')] }]);
      useItineraryEditStore
        .getState()
        .seed([{ date: D1, slots: [slotAt('ghost', '08:00:00', '09:00:00')] }]);
      const { client } = renderTree();
      await ready(client);
      // 앵커 — 추가 전엔 토스트가 없다.
      expect(screen.queryByTestId(TOAST)).toBeNull();

      await add('p1');

      await waitFor(() => expect(putBodies).toHaveLength(1));
      expect(sent(0, D1).map(([poiId]) => poiId)).toEqual(['sA', 'p1']);
      expect(await screen.findByTestId(TOAST)).toHaveTextContent(
        '추가했어요 · 일정에 바로 저장됐어요'
      );
    },
    SLOW
  );

  /**
   * TRIP-1640 (M-37) — 한 화면에서 여러 곳을 연달아 담는다. 라우트 `insertAfter` 는 화면이 떠 있는 동안 안 바뀌므로
   * 둘째부터는 "선행 카드 바로 뒤"가 이미 첫째의 자리다 — 저장에 성공한 추가 수만큼 삽입 자리를 뒤로 밀어야
   * 둘째가 첫째 앞에 끼지 않고, 기본 시각도 첫째 종료부터가 된다. 실패한 추가는 세지 않는다.
   * 이 describe 는 위 TRIP-1424 describe 의 `echo`·`serveDays`·`ready`·`add`·`sent` 를 그대로 쓰려고 그 안에 둔다.
   *
   * 3동작 뼈대: 준비 = 08:00–09:30 sA · 13:00–14:00 sB 와 라우트 insertAfter=0(sA 뒤 「+」) → 실행 = 같은 화면에서
   * 장소를 연달아 [적용] → 단언 = 나간 PUT 들의 슬롯 순서·시각, 편집 초안 순서.
   */
  describe('연달아 담기 — 삽입 자리가 저장에 성공한 만큼 뒤로 밀린다', () => {
    const SA = slotAt('sA', '08:00:00', '09:30:00');
    const SB = slotAt('sB', '13:00:00', '14:00:00');

    beforeEach(() => {
      mockParams = { tripId: 't1', insertAfter: '0' };
      serveDays([{ date: D1, slots: [SA, SB] }]);
    });

    /** 「+ 추가」 → [적용] → 그 PUT 이 끝난 것(행이 "추가됨")까지 기다린다 — 끝나기 전 다음 「+ 추가」는 무시된다(저장 중 잠금). */
    async function addAndSettle(poiId: string): Promise<void> {
      await add(poiId);
      await screen.findByTestId(`itinerary-place-added-${poiId}`);
      // 한 틱 더 — 행 표시(onSuccess)와 저장 중 잠금 해제(onSettled) 사이를 건넌다.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    it(
      '🔴 S1 · 연달아 세 곳을 담으면 담은 순서대로 선행 카드 바로 뒤에 이어 붙는다 [sA, p1, p2, p3, sB]',
      async () => {
        const { client } = renderTree();
        await ready(client);

        await addAndSettle('p1');
        // 앵커 — 첫 저장은 원래 자리(sA 바로 뒤)에 들어갔고 편집기 대역(같은 캐시)도 그렇게 본다.
        expect(sent(0, D1).map(([poiId]) => poiId)).toEqual(['sA', 'p1', 'sB']);
        expect(screen.getByTestId(EDITOR)).toHaveTextContent('sA,p1,sB');

        await addAndSettle('p2');
        await addAndSettle('p3');

        await waitFor(() => expect(putBodies).toHaveLength(3));
        // 둘째는 첫째 뒤, 셋째는 둘째 뒤 — 고정 자리면 [sA, p2, p1, sB] · [sA, p3, p2, p1, sB] 로 거꾸로 쌓인다.
        expect(sent(1, D1).map(([poiId]) => poiId)).toEqual([
          'sA',
          'p1',
          'p2',
          'sB',
        ]);
        expect(sent(2, D1).map(([poiId]) => poiId)).toEqual([
          'sA',
          'p1',
          'p2',
          'p3',
          'sB',
        ]);
      },
      SLOW
    );

    it(
      '🔴 S2 · 둘째 장소의 기본 시각은 첫째 종료부터 1시간이다 — 첫째와 겹치지 않는다 (09:30–10:30 → 10:30–11:30)',
      async () => {
        const { client } = renderTree();
        await ready(client);

        await addAndSettle('p1');
        await addAndSettle('p2');

        await waitFor(() => expect(putBodies).toHaveLength(2));
        // 앵커 — 첫째는 sA 종료(09:30)부터, 둘째 PUT 에도 그대로 실려 간다.
        expect(sent(0, D1)).toContainEqual(['p1', '09:30:00']);
        expect(sent(1, D1)).toContainEqual(['p1', '09:30:00']);
        // 둘째 = 첫째 종료(10:30)부터. 고정 기준(sA)이면 09:30 으로 첫째와 같은 시각이 된다.
        const second = putBodies[1].days
          .find((day) => day.date === D1)
          ?.slots.find((one) => one.poiId === 'p2');
        expect({ startAt: second?.startAt, endAt: second?.endAt }).toEqual({
          startAt: '10:30:00',
          endAt: '11:30:00',
        });
      },
      SLOW
    );

    it(
      '🔴 S3 · 저장 안 한 편집 초안이 있어도 둘째 성공 추가가 초안에서 첫째 바로 뒤에 들어가고, 저장 안 한 변경(dirty)은 그대로다',
      async () => {
        // 준비 — 초안을 서버와 같은 [sA, sB] 로 심고 시각을 하나 바꿔 dirty 로 만든다(seed 만으론 dirty=false 다).
        const store = useItineraryEditStore.getState();
        store.seed([{ date: D1, slots: [SA, SB] }]);
        store.adjustSlotTime(D1, 'sB', {
          startAt: '13:10:00',
          endAt: '14:00:00',
          endsNextDay: false,
        });
        const draftIds = (): string[] =>
          useItineraryEditStore
            .getState()
            .days.find((day) => day.date === D1)
            ?.slots.map((one) => one.poiId) ?? [];
        expect(useItineraryEditStore.getState().dirty).toBe(true);
        const { client } = renderTree();
        await ready(client);

        await addAndSettle('p1');
        // 앵커 — 첫째는 초안에서도 sA 바로 뒤다.
        expect(draftIds()).toEqual(['sA', 'p1', 'sB']);

        await addAndSettle('p2');

        // 고정 자리면 초안이 [sA, p2, p1, sB] 로 뒤집혀 서버(캐시)와 어긋난다.
        expect(draftIds()).toEqual(['sA', 'p1', 'p2', 'sB']);
        expect(useItineraryEditStore.getState().dirty).toBe(true);
        expect(sent(1, D1).map(([poiId]) => poiId)).toEqual([
          'sA',
          'p1',
          'p2',
          'sB',
        ]);
      },
      SLOW
    );

    it(
      '🟢 S4 · 첫 저장이 실패하면 자리가 밀리지 않는다 — 다음 담기는 원래 자리(sA 바로 뒤)·원래 기준 시각 (선제 green · 성공만 세는지 지키는 짝)',
      async () => {
        let calls = 0;
        respond = (body) => {
          calls += 1;
          return calls === 1
            ? HttpResponse.json(
                { error: { code: 'INTERNAL' } },
                { status: 500 }
              )
            : HttpResponse.json(echo(body));
        };
        const { client } = renderTree();
        await ready(client);

        await add('p1');
        // 앵커 — 첫 저장이 실패 안내까지 갔고, 실패한 p1 은 PUT 에 [sA, p1, sB] 로 실려 갔다.
        await screen.findByTestId(ERROR);
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(sent(0, D1).map(([poiId]) => poiId)).toEqual(['sA', 'p1', 'sB']);

        await addAndSettle('p2');

        await waitFor(() => expect(putBodies).toHaveLength(2));
        // 시도를 세면 자리가 하나 밀려 [sA, sB, p2] 가 된다. 캐시엔 p1 이 없으니 앞 장소는 여전히 sA(09:30 종료).
        expect(sent(1, D1)).toEqual([
          ['sA', '08:00:00'],
          ['p2', '09:30:00'],
          ['sB', '13:00:00'],
        ]);
      },
      SLOW
    );
  });
});

/**
 * TRIP-1433 · Q-142 — 같은 이름 장소(경복궁 여럿)를 행 부제의 지역·주소로 가른다.
 *
 * 1줄 = [지역(있을 때만), #태그…, 카테고리] · 2줄 = 주소(있을 때만, testID `itinerary-place-address-{poiId}`).
 * null·키 없음·빈 문자열·공백뿐은 전부 없음 — 지금 부제 그대로, 값을 지어내지 않는다. 이름은 원문 그대로.
 * 조합 전체는 `features/itinerary/model/placeAddSubtitle.test.ts` 가 표·속성으로 재고, 여기서는 페이지가
 * 서버 응답을 행으로 그리는 배선을 잰다.
 *
 * ⚠️ `/places` 를 쿼리를 보지 않는 고정 응답으로 덮는다 — 쿼리 `region`(목적지 '부산')과 `Place.region`(시군구
 *   '종로구')은 다른 값이라, 지역으로 거르는 가짜 서버를 쓰면 이 행들이 지워져 안 뜬다.
 * 생김새(줄 수·색·말줄임)는 재지 않는다(README 판정 4 — 6-b 실기 몫).
 *
 * 3동작 뼈대: 준비=고정 응답 → 실행=페이지 렌더(·추가) → 단언=행 안의 1줄 문자열·주소 줄 testID·나간 PUT.
 */
describe('장소 추가 행 부제 — 같은 이름 장소를 지역·주소로 가른다', () => {
  const ADDRESS_K1 = '서울특별시 종로구 사직로 161';
  const ADDRESS_K5 = '서울특별시 마포구 월드컵북로 400';

  function samePlace(
    poiId: string,
    nameKo: string,
    category: Place['category'],
    tags: string[],
    region: string | null | undefined,
    address: string | null
  ): Place {
    return { ...makePlace(poiId, nameKo, category, 0), tags, region, address };
  }

  // k5 의 region undefined 는 JSON 으로 나갈 때 키째 빠진다(생성 타입 `region?` 경로).
  const SAME_NAME: Place[] = [
    samePlace('k1', '경복궁', '명소', ['고궁'], '종로구', ADDRESS_K1),
    samePlace('k2', '경복궁', '맛집', ['한식'], '중구', null),
    samePlace('k3', '경복궁', '맛집', ['한식'], null, null),
    samePlace('k4', '경복궁', '맛집', ['한식'], '   ', '  '),
    samePlace('k5', '경복궁', '맛집', ['한식'], undefined, ADDRESS_K5),
    samePlace('k6', '[백년가게]옥미아구찜', '맛집', [], '마산합포구', null),
  ];

  const card = (poiId: string) =>
    screen.getByTestId(`itinerary-place-card-${poiId}`);
  const addressId = (poiId: string) => `itinerary-place-address-${poiId}`;

  beforeEach(() => {
    server.use(
      http.get(`${BASE}/places`, () =>
        HttpResponse.json({ items: SAME_NAME, nextCursor: null })
      )
    );
  });

  async function renderSameName() {
    render(<PlaceAddPage tripId="t1" />, { wrapper: createWrapper() });
    await screen.findByTestId('itinerary-place-card-k1');
  }

  it('🔴 N1 · 이름이 같은 두 행은 1줄 맨 앞의 지역이 달라 서로 구분된다', async () => {
    await renderSameName();

    expect(within(card('k1')).getByText('경복궁')).toBeOnTheScreen();
    expect(within(card('k2')).getByText('경복궁')).toBeOnTheScreen();
    expect(
      within(card('k1')).getByText('종로구 · #고궁 · 명소')
    ).toBeOnTheScreen();
    expect(
      within(card('k2')).getByText('중구 · #한식 · 맛집')
    ).toBeOnTheScreen();
  });

  it('🔴 N2 · 주소가 있으면 그 행 안에 주소 줄이 원문으로 뜬다', async () => {
    await renderSameName();

    expect(within(card('k1')).getByTestId(addressId('k1'))).toHaveTextContent(
      ADDRESS_K1
    );
  });

  it('🔴 N3 · 지역만 있으면 주소 줄이 없고, 주소만 있으면 1줄은 그대로에 주소 줄만 생긴다', async () => {
    await renderSameName();

    expect(screen.queryByTestId(addressId('k2'))).toBeNull();
    expect(within(card('k5')).getByText('#한식 · 맛집')).toBeOnTheScreen();
    expect(within(card('k5')).getByTestId(addressId('k5'))).toHaveTextContent(
      ADDRESS_K5
    );
  });

  it('🔴 N4 · 지역·주소가 둘 다 null 이면 지금 부제 그대로고 주소 줄·"null"·"미확인" 글자가 없다', async () => {
    await renderSameName();
    // 앵커 — 주소 줄을 그리는 화면에서만 "없다"가 의미 있다.
    expect(within(card('k1')).getByTestId(addressId('k1'))).toBeOnTheScreen();

    const row = card('k3');
    expect(within(row).getByText('#한식 · 맛집')).toBeOnTheScreen();
    expect(screen.queryByTestId(addressId('k3'))).toBeNull();
    expect(within(row).queryAllByText(/null|undefined|미확인/)).toEqual([]);
  });

  it('🔴 N5 · 빈 문자열·공백뿐인 지역·주소는 없음과 같다 (빈 조각·빈 줄 없음)', async () => {
    await renderSameName();
    // 앵커 — 주소 줄을 그리는 화면에서만 "없다"가 의미 있다.
    expect(within(card('k1')).getByTestId(addressId('k1'))).toBeOnTheScreen();

    expect(within(card('k4')).getByText('#한식 · 맛집')).toBeOnTheScreen();
    expect(screen.queryByTestId(addressId('k4'))).toBeNull();
  });

  it('N6 · 이름 접두([백년가게])는 원문 그대로다 (사용자 결정 · 선제 green)', async () => {
    await renderSameName();

    expect(
      within(card('k6')).getByText('[백년가게]옥미아구찜')
    ).toBeOnTheScreen();
  });

  it('N7 · 같은 이름 중 둘째 행(k2)을 담으면 PUT 에 k2 가 실리고 k1 은 안 실린다 (무회귀 · 선제 green)', async () => {
    await renderSameName();

    await addPlaceAndApply('k2');

    await waitFor(() => expect(putBodies).toHaveLength(1));
    const day = putBodies[0].days.find((d) => d.date === '2026-06-10');
    const ids = day?.slots.map((slot) => slot.poiId);
    expect(ids).toContain('k2');
    expect(ids).not.toContain('k1');
  });
});
