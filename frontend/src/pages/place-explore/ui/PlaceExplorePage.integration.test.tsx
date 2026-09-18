import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import { PlaceExplorePage } from './PlaceExplorePage';

/**
 * AC-3 · AC-4 · AC-5 · AC-6 · AC-7 · AC-8 (+ 01b Seed Q1·Q3·Q9) — d04 배선.
 *
 * 무엇을 보장하나:
 *  - **P-1 (AC-3)** 카테고리 칩은 `category` 파라미터로 **서버를 다시 부르고**, 그 응답이 카드에
 *    반영된다. 선택된 칩만 활성이다.
 *  - **P-2 (Seed Q9)** 라우트에 `region` 이 있으면 싣고, 없으면 파라미터 자체를 만들지 않는다.
 *  - **P-3 (AC-8·TRIP-502)** 검색은 **서버가 한다**(`q`) — 클라 재정렬 없이 서버 순서를 그린다.
 *  - **P-4 (AC-4)** 하트를 누르면 **서버가 답하기 전에** 담김 표기와 CTA 숫자가 바뀐다.
 *  - **P-5 (AC-5)** 해제는 `savedPlaceId` 로 나가고, 0곳이 되면 CTA 바가 사라진다.
 *  - **P-6 (AC-6)** CTA 는 여행 생성 1/2 로 보낸다.
 *  - **P-7 (Seed Q1·BR-U1-03)** 게스트는 담은 목록 조회조차 보내지 않는다.
 *  - **P-8 (TRIP-502)** 목록 끝에 닿으면 `nextCursor` 로 다음 장을 이어 받는다(무한 스크롤).
 *  - **P-9 (TRIP-687)** 라우트 `region` 이 2곳 이상이면 지역별로 `getPlaces` 를 각 1회 부르고
 *    (fan-out) 병합 결과를 한 목록에 함께 그린다 — 단일지역 경로(P-2)의 무한 스크롤은 안 탄다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 나간 요청**"이다. 직렬화가 끝난 최종 URL·재요청
 * 횟수·나간 경로의 id 는 msw 만 관찰할 수 있다(`savedPlaces.integration.test.tsx` 계승).
 *
 * ★ 낙관 단언의 비결정성을 두 겹으로 막는다(TRIP-220 B-1 재발 방지).
 *   ① `POST`/`DELETE` 를 **문(gate) 뒤**에 세운다 — "서버 응답 전"이 시간이 아니라 신호가 된다.
 *   ② 목을 **상태 있는 배열**로 만든다 — 무효화 재조회가 언제 도착하든 답이 낙관 반영과 같다.
 *   단언은 `waitFor` 로 감싼다: TanStack Query 의 통지는 항상 매크로태스크를 한 칸 거친다.
 */

// authedClient(생성 클라이언트가 타는 mutator 의 인증 계층)가 @/shared/storage 를 정적으로
// 물고 있다 — expo-secure-store 실물 로드를 피하려면 목킹해야 한다(리포 관례).
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
// region 은 '더 담기'가 여행지 여러 곳을 같은 키로 반복해 실으면 배열이 된다(expo-router 규약) —
// P-9(다지역)를 위해 배열도 허용한다(단일지역 케이스 P-2 는 string 그대로 유효).
let mockParams: { region?: string | string[] } = {};

// 정적 `router` 싱글턴과 `useRouter()` 훅을 **둘 다** 같은 목으로 준다 — 배선이 어느 쪽을
// 쓰든 이 파일의 단언은 같다(리포에 두 선례가 공존한다: StaySearchPage vs TripNewStep1Page).
// ★ `router.push` 는 화살표로 한 겹 감싸 **지연 참조**한다. `jest.mock` 팩토리는 hoist 되어
// `const mockPush` 선언보다 먼저 도는데, `router: { push: mockPush }` 처럼 즉시 읽으면 그
// 시점의 undefined 가 박혀 `router.push is not a function` 이 난다(실측). `useRouter` 쪽이
// 멀쩡한 것은 호출 시점에야 읽기 때문이다 — 리포 선례가 전부 훅 형태라 이 함정이 숨어 있었다.
jest.mock('expo-router', () => ({
  router: { push: (href: string) => mockPush(href) },
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({ ...mockParams }),
}));

/** authWiring.integration.test.ts:59 와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';

function makePlace(
  poiId: string,
  nameKo: string,
  category: Place['category'],
  region: string | null,
  savedCount: number
): Place {
  return {
    poiId,
    nameKo,
    category,
    lat: 35.1587,
    lng: 129.1604,
    region,
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount,
    dataStatus: 'ACTIVE',
  };
}

/** 서버가 주는 순서는 savedCount 순서와 다르다 — 화면 순서가 곧 클라 정렬의 증거가 된다. */
const PLACES: Place[] = [
  makePlace('p1', '감천문화마을', '명소', '사하구', 12),
  makePlace('p2', '광안리 해변', '야경', '수영구', 30),
  makePlace('p3', '전포 카페거리', '카페', null, 7),
  makePlace('p4', '해동용궁사', '명소', '기장군', 3),
  makePlace('p5', '자갈치 시장', '맛집', '중구', 21),
];

function savedRowOf(poiId: string): SavedPlace {
  return {
    savedPlaceId: `saved-${poiId}`,
    savedAt: '2026-08-01T00:00:00Z',
    place: PLACES.find((place) => place.poiId === poiId) ?? PLACES[0],
  };
}

/**
 * 테스트가 풀어 줄 때까지 응답하지 않는 문(`savedPlaces.integration.test.tsx:101` 선례).
 * `delay(ms)` 로 재면 느린 CI 에서 흔들리고, "아직 안 왔다"를 결정론적으로 보장하지 못한다.
 */
function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

/** 서버가 실제로 들고 있는 담은 목록 — POST/DELETE 가 이 배열을 고친다(★ 겹②). */
let savedRows: SavedPlace[] = [];
let gate = createGate();
let observed: { method: string; url: string }[] = [];

function hitsOf(method: string, pathname: string) {
  return observed.filter(
    (hit) => hit.method === method && new URL(hit.url).pathname === pathname
  );
}

function cardTestIds(): string[] {
  return screen
    .getAllByTestId(/^explore-places-card-/)
    .map((node) => String(node.props.testID));
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observed.push({ method: request.method, url: request.url });
  });
});

beforeEach(() => {
  observed = [];
  savedRows = [];
  mockParams = {};
  mockPush.mockClear();
  clearAccessToken();
  // 기본 gate 는 열려 있다 — "즉시 반영"을 재는 케이스만 닫힌 문으로 갈아 끼운다.
  gate = createGate();
  gate.release();

  // 기본 handlers.ts 에 places 계열이 0건이고 `onUnhandledRequest: 'error'` 라, 안 건 요청은
  // 조용히 통과하지 않고 에러가 된다 — 그 성질을 그대로 쓴다.
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
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(savedRows)),
    http.post(`${BASE}/saved-places`, async ({ request }) => {
      await gate.opened;
      const body = (await request.json()) as { poiId: string };
      const row = savedRowOf(body.poiId);
      savedRows = [...savedRows, row];
      return HttpResponse.json(row, { status: 201 });
    }),
    http.delete(`${BASE}/saved-places/:savedPlaceId`, async ({ params }) => {
      await gate.opened;
      savedRows = savedRows.filter(
        (row) => row.savedPlaceId !== params.savedPlaceId
      );
      return new HttpResponse(null, { status: 204 });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime: 0 — 기본값이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를
      // 붙잡는다. **mutations 쪽도 반드시 0** 이다(빼면 이 버킷이 300초 매달린다, 리포 실측).
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

/** 목록이 도착해 카드가 그려진 상태까지 만든다 — 이후 증가분이 곧 이 칸의 사정거리다. */
async function renderPage() {
  render(<PlaceExplorePage />, { wrapper: createWrapper() });
  await waitFor(() =>
    expect(
      screen.getAllByTestId(/^explore-places-card-/).length
    ).toBeGreaterThan(0)
  );
}

describe('P-1 · 카테고리 칩은 서버를 다시 부른다 (AC-3)', () => {
  it('선택한 category 가 요청 URL 에 실리고, 응답이 카드에 반영되며, 그 칩만 활성이다', async () => {
    setAccessToken('valid-access');

    await renderPage();

    // 앵커 — 첫 조회는 필터가 없다(Seed Q9: region 도 생략 = 전국).
    const first = hitsOf('GET', '/api/v1/places');
    expect(first).toHaveLength(1);
    expect(new URL(first[0].url).searchParams.get('category')).toBeNull();
    expect(new URL(first[0].url).searchParams.get('region')).toBeNull();

    fireEvent.press(screen.getByTestId('explore-places-category-food'));

    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(2)
    );
    // URL.searchParams.get() 이 퍼센트 인코딩을 자동으로 되돌리므로 한글 비교가 성립한다.
    // '맛집'은 계약 enum 값 자체라 ASCII 로 바꿀 수 없다.
    const second = hitsOf('GET', '/api/v1/places')[1];
    expect(new URL(second.url).searchParams.get('category')).toBe('맛집');

    // 재조회 결과가 실제로 화면에 닿았다 — URL 만 보면 "보내고 버리는" 구현도 통과한다.
    await waitFor(() =>
      expect(cardTestIds()).toEqual(['explore-places-card-p5'])
    );
    expect(screen.getByTestId('explore-places-category-food')).toBeSelected();
    expect(
      screen.getByTestId('explore-places-category-all')
    ).not.toBeSelected();
  });
});

describe('P-2 · region 라우트 파라미터 (01b Seed Q9)', () => {
  it('라우트에 region 이 있으면 그대로 싣는다', async () => {
    setAccessToken('valid-access');
    // ASCII 를 쓴다 — 한글은 퍼센트 인코딩되어 실패 메시지를 읽을 수 없다(리포 관례).
    mockParams = { region: 'jeju' };

    await renderPage();

    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits).toHaveLength(1);
    expect(new URL(hits[0].url).searchParams.get('region')).toBe('jeju');

    // TRIP-692 AC-4 — 단일/0지역은 usePlacesInfinite 경로라 degraded 개념이 없다
    // (페이지가 항상 false 전달) → 배너 없음. 선제 green 회귀 앵커.
    expect(screen.queryByTestId('explore-places-partialfailure')).toBeNull();
  });
});

describe('P-3 · 검색은 서버가 한다 (q) — 로드된 페이지 한정이 아니다 (AC-8 · TRIP-502)', () => {
  it('서버가 준 순서를 그대로 그리고, 검색어를 넣으면 q 로 서버를 다시 부른다', async () => {
    setAccessToken('valid-access');

    await renderPage();

    // 서버가 준 순서 그대로 그린다 — 클라 재정렬 없음(정렬은 서버 소유=이름순, TRIP-502).
    // 예전엔 visiblePlaces 가 savedCount 내림차순으로 클라 정렬했으나 그 층을 걷어냈다.
    expect(cardTestIds()).toEqual([
      'explore-places-card-p1',
      'explore-places-card-p2',
      'explore-places-card-p3',
      'explore-places-card-p4',
      'explore-places-card-p5',
    ]);

    fireEvent.changeText(screen.getByTestId('explore-places-search'), '해변');

    // 검색은 서버가 한다 — q 를 실은 새 요청이 나가고, 서버가 거른 결과만 남는다(로드된 페이지 한정 아님).
    await waitFor(() =>
      expect(cardTestIds()).toEqual(['explore-places-card-p2'])
    );
    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(new URL(hits[hits.length - 1].url).searchParams.get('q')).toBe(
      '해변'
    );
  });
});

describe('P-4 · 담기 — 응답 전에 반영되고 CTA 숫자가 오른다 (AC-4 · AC-6)', () => {
  it('서버가 답하기 전에 담음 배지와 CTA(1)가 생기고, 재조회 후에도 유지된다', async () => {
    setAccessToken('valid-access');

    await renderPage();

    // 앵커 — 담은 곳이 0이면 CTA 바 자체가 없다(01b Seed Q3 · BR-U1-09 조건절).
    expect(screen.queryByTestId('explore-places-createtrip')).toBeNull();
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(1);

    gate = createGate(); // 이 시점부터 POST 는 문 뒤에 선다
    fireEvent.press(screen.getByTestId('explore-places-save-p2'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-createtrip')).toBeOnTheScreen()
    );
    const cta = screen.getByTestId('explore-places-createtrip');
    expect(within(cta).getByText('1')).toBeOnTheScreen();
    const card = screen.getByTestId('explore-places-card-p2');
    expect(within(card).getByText('담음')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-places-save-p2')).toBeSelected();

    // 요청은 실제로 나갔고(낙관만 하고 안 보내는 구현이 아니다), **아직 답은 오지 않았다**
    // — 무효화 재조회가 0건인 것이 그 증거다.
    expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(1);
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(1);

    gate.release();

    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(2)
    );
    // 서버 진실이 도착해도 담김이 유지된다(목이 낙관 반영과 정합이므로 이 단언은 타이밍이
    // 아니라 "무효화 뒤 상태"를 잰다).
    expect(
      within(screen.getByTestId('explore-places-card-p2')).getByText('담음')
    ).toBeOnTheScreen();
  });
});

describe('P-5 · 해제 — savedPlaceId 로 나가고 0곳이면 CTA 가 사라진다 (AC-5)', () => {
  it('응답 전에 배지가 빠지고, 해제 요청이 담기 기록 id 를 싣는다', async () => {
    setAccessToken('valid-access');
    savedRows = [savedRowOf('p1')];

    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-createtrip')).toBeOnTheScreen()
    );
    expect(
      within(screen.getByTestId('explore-places-createtrip')).getByText('1')
    ).toBeOnTheScreen();

    gate = createGate();
    fireEvent.press(screen.getByTestId('explore-places-save-p1'));

    await waitFor(() =>
      expect(screen.queryByTestId('explore-places-createtrip')).toBeNull()
    );
    expect(
      within(screen.getByTestId('explore-places-card-p1')).queryAllByText(
        '담음'
      )
    ).toHaveLength(0);
    expect(screen.getByTestId('explore-places-save-p1')).not.toBeSelected();

    // 담기 기록 id 로 나갔다. 부정 짝이 없으면 poiId 를 실은 구현이 404 를 받고, 그 실패가
    // 롤백에 흡수되어 "동작은 하는데 아무것도 안 되는" 모양으로 조용히 남는다.
    expect(hitsOf('DELETE', '/api/v1/saved-places/saved-p1')).toHaveLength(1);
    expect(hitsOf('DELETE', '/api/v1/saved-places/p1')).toHaveLength(0);

    gate.release();
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(2)
    );
  });
});

describe('P-6 · CTA 는 여행 생성 1/2 로 보낸다 (AC-6 · US-SHELL-05)', () => {
  it('CTA 를 누르면 /trips/new/step1 로 이동한다', async () => {
    setAccessToken('valid-access');
    savedRows = [savedRowOf('p1')];

    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-createtrip')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('explore-places-createtrip'));

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });
});

describe('P-7 · 게스트는 담은 목록을 아예 부르지 않는다 (01b Seed Q1 · BR-U1-03)', () => {
  it('토큰이 없으면 GET /saved-places 가 0건이고 CTA 가 없다', async () => {
    // 서버에는 담은 기록이 있다 — 그래도 요청을 보내지 않는 것이 규칙이다.
    savedRows = [savedRowOf('p1')];

    await renderPage();

    // 장소 목록이 왕복을 **끝냈다**면 담은 목록 요청도 이미 나갔어야 한다 — 그래서 이 0건은
    // "아직 안 나갔다"가 아니라 "안 나간다"다.
    expect(hitsOf('GET', '/api/v1/places')).toHaveLength(1);
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(0);

    // 게스트에게는 담은 곳이 0이므로 CTA 도 없다.
    expect(screen.queryByTestId('explore-places-createtrip')).toBeNull();

    // 긍정 짝 — 화면은 정상으로 돌았다(목록 열람은 미로그인도 가능한 화면이다).
    expect(cardTestIds()).toHaveLength(5);
    expect(
      within(screen.getByTestId('explore-places-card-p1')).queryAllByText(
        '담음'
      )
    ).toHaveLength(0);
  });
});

describe('P-8 · 모두 보기는 커서로 이어 받는다 (무한 스크롤 · TRIP-502)', () => {
  it('목록 끝에 닿으면 nextCursor 로 다음 장을 이어 받는다', async () => {
    setAccessToken('valid-access');
    const PAGE2 = [makePlace('p6', '태종대', '명소', '영도구', 5)];
    // 첫 장은 nextCursor 를 주고, cursor 가 실린 요청엔 다음 장을 준다.
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return cursor
          ? HttpResponse.json({ items: PAGE2, nextCursor: null })
          : HttpResponse.json({ items: PLACES, nextCursor: 'CURSOR_2' });
      })
    );

    await renderPage();
    expect(cardTestIds()).toHaveLength(5);

    // 목록 끝에 닿음 → 다음 장 요청. onEndReached 배선을 지우면 p6 가 안 와 red 가 된다(뮤테이션 심판).
    fireEvent(screen.getByTestId('explore-places-grid'), 'endReached');

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-card-p6')).toBeOnTheScreen()
    );
    // 첫 장 + 다음 장이 함께 그려진다(5 + 1).
    expect(cardTestIds()).toHaveLength(6);
    // 다음 장 요청에 cursor 가 실린다(첫 요청엔 없다).
    const hits = hitsOf('GET', '/api/v1/places');
    expect(new URL(hits[hits.length - 1].url).searchParams.get('cursor')).toBe(
      'CURSOR_2'
    );
  });
});

describe('P-9 · 다지역이면 지역별로 조회해 한 목록에 합쳐 그린다 (TRIP-687 · code-critic 경고-1 봉합)', () => {
  // 부산·경주 각각 다른 장소를 준다 — poiId 가 안 겹쳐 병합 후에도 4장이 모두 남는다.
  const BUSAN: Place[] = [
    makePlace('b1', '감천문화마을', '명소', '부산광역시', 12),
    makePlace('b2', '광안리 해변', '야경', '부산광역시', 30),
  ];
  const GYEONGJU: Place[] = [
    makePlace('g1', '불국사', '명소', '경주시', 40),
    makePlace('g2', '첨성대', '명소', '경주시', 15),
  ];

  it('getPlaces 가 지역마다 한 번씩(2회) 나가고, 부산·경주 장소가 한 목록에 함께 그려진다', async () => {
    setAccessToken('valid-access');
    // 라우트가 여행지 2곳을 배열로 실어 보낸다 → PlaceExplorePage 가 다지역 병합 경로로 갈린다.
    mockParams = { region: ['부산광역시', '경주시'] };
    // region 파라미터로 갈라 지역별 응답을 준다(P-8 의 server.use 오버라이드 선례와 동형).
    // region 이 없는 헛조회가 새면 빈 목록이 오고, 아래 "정확히 2회" 단언이 그것을 red 로 잡는다.
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region');
        if (region === '부산광역시')
          return HttpResponse.json({ items: BUSAN, nextCursor: null });
        if (region === '경주시')
          return HttpResponse.json({ items: GYEONGJU, nextCursor: null });
        return HttpResponse.json({ items: [], nextCursor: null });
      })
    );

    await renderPage();

    // ① fan-out — 지역당 정확히 1회씩, 총 2회. 다지역인데 usePlacesInfinite 가 enabled 게이팅이
    //    깨져 전국을 헛조회하면 3회, regions.map 이 둘째 지역을 빠뜨리면 1회가 되어 둘 다 red.
    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits).toHaveLength(2);

    // ② 나간 두 요청의 region 이 부산·경주 각각이다(발사 순서는 안 굳힌다 — 두 값의 존재만 본다).
    const regionsCalled = hits.map((hit) =>
      new URL(hit.url).searchParams.get('region')
    );
    expect(regionsCalled).toContain('부산광역시');
    expect(regionsCalled).toContain('경주시');

    // ③ 병합 결과 — 부산 2곳 + 경주 2곳이 한 목록에 함께 뜬다(입력 순서 보존 = 부산 먼저).
    //    둘째 지역 누락 뮤턴트면 경주 카드(g1·g2)가 없어 red.
    expect(cardTestIds()).toEqual([
      'explore-places-card-b1',
      'explore-places-card-b2',
      'explore-places-card-g1',
      'explore-places-card-g2',
    ]);

    // TRIP-692 AC-3 — 전부 성공이면 degraded 가 false 라 배너가 없다(회귀 앵커: 배너가
    // 잘못 뜨면 red). 부재 단언이라 구현 전에도 통과하는 선제 green.
    expect(screen.queryByTestId('explore-places-partialfailure')).toBeNull();
  });
});

describe('P-10 · 다지역 부분 성공 — 한 지역이 실패해도 나머지는 뜬다 (TRIP-691 · RESILIENCY · INV-4)', () => {
  // 부산은 응답, 경주는 500 으로 실패시킨다. Promise.all 이면 한쪽 실패가 전체를 error 로 접어
  // 부산 장소도 안 뜬다(부분 성공 없음). Promise.allSettled 로 바꾸면 성공한 부산만 병합돼 뜬다.
  const BUSAN: Place[] = [
    makePlace('b1', '감천문화마을', '명소', '부산광역시', 12),
    makePlace('b2', '광안리 해변', '야경', '부산광역시', 30),
  ];

  it('경주 조회가 실패해도 부산 장소는 그대로 뜬다 (부분 성공, AC-1)', async () => {
    setAccessToken('valid-access');
    // 준비(Arrange) — 여행지 2곳, 경주만 서버 500.
    mockParams = { region: ['부산광역시', '경주시'] };
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region');
        if (region === '부산광역시')
          return HttpResponse.json({ items: BUSAN, nextCursor: null });
        // 경주는 실패 — allSettled 면 조용히 탈락, all 이면 전체가 error 로 접힌다.
        return new HttpResponse(null, { status: 500 });
      })
    );

    // 실행(Act) — 화면을 그린다.
    render(<PlaceExplorePage />, { wrapper: createWrapper() });

    // 단언(Assert) — 부산 두 장이 뜨고(부분 성공), 경주는 없다, error 얼굴도 아니다.
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-card-b1')).toBeTruthy()
    );
    expect(screen.getByTestId('explore-places-card-b2')).toBeTruthy();
    expect(screen.queryByTestId('explore-places-card-g1')).toBeNull();
    expect(screen.queryByTestId('explore-places-error')).toBeNull();
  });

  it('모든 지역이 실패하면 error 얼굴을 보인다 — 빈 목록을 성공으로 위장하지 않는다 (AC-2, INV-4)', async () => {
    setAccessToken('valid-access');
    // 준비 — 두 지역 다 500. allSettled 라도 "전부 실패면 throw" 가드가 없으면 빈 목록을
    // 성공으로 위장해 error 가 안 뜬다. 이 케이스가 그 가드를 강제한다.
    mockParams = { region: ['부산광역시', '경주시'] };
    server.use(
      http.get(`${BASE}/places`, () => new HttpResponse(null, { status: 500 }))
    );

    render(<PlaceExplorePage />, { wrapper: createWrapper() });

    // 단언 — 조회 실패 안내(다시 시도)가 뜨고 카드는 없다.
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-error')).toBeTruthy()
    );
    expect(screen.queryByTestId('explore-places-card-b1')).toBeNull();

    // TRIP-692 AC-2 — 전부 실패는 훅이 throw(lists.length===0) → error 얼굴이지 degraded 가
    // 아니다. degraded 배너와 error 얼굴이 섞이지 않음을 잠근다(기존 throw 경로 무변경 회귀 앵커).
    expect(screen.queryByTestId('explore-places-partialfailure')).toBeNull();
  });
});

describe('P-11 · 다지역 부분 실패면 degraded 배너를 얹고 다시 시도가 실제 재조회한다 (TRIP-692 · AC-1 · AC-6)', () => {
  // 부산은 응답, 경주는 500. Promise.allSettled 라 부산은 병합돼 뜨고, 경주 실패로 degraded 가
  // 참이 된다 — 그때 성공 목록 위에 배너가 얹힌다. degraded 는 서버 필드가 아니라 이 성공/실패
  // 개수에서 클라가 파생한다(brief §맹점① — /places 응답엔 degraded 필드가 없어 아래 핸들러도
  // {items,nextCursor} 만 준다).
  const BUSAN: Place[] = [
    makePlace('b1', '감천문화마을', '명소', '부산광역시', 12),
    makePlace('b2', '광안리 해변', '야경', '부산광역시', 30),
  ];

  function usePartialFailureHandler() {
    mockParams = { region: ['부산광역시', '경주시'] };
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region');
        if (region === '부산광역시')
          return HttpResponse.json({ items: BUSAN, nextCursor: null });
        // 경주는 실패 — allSettled 가 부분 실패로 접어 degraded=true.
        return new HttpResponse(null, { status: 500 });
      })
    );
  }

  it('부분 실패면 부산 카드는 그대로 뜨고 그 위에 배너가 얹힌다 — error 얼굴이 아니다 (AC-1)', async () => {
    setAccessToken('valid-access');
    usePartialFailureHandler();

    render(<PlaceExplorePage />, { wrapper: createWrapper() });

    // 배너가 뜬다(성공분은 살아 있고 부분 실패만 알린다).
    await waitFor(() =>
      expect(
        screen.getByTestId('explore-places-partialfailure')
      ).toBeOnTheScreen()
    );
    // 부산 두 장은 그대로 — degraded 는 목록을 지우지 않고 표식만 얹는다.
    expect(screen.getByTestId('explore-places-card-b1')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-places-card-b2')).toBeOnTheScreen();
    // 부분 실패는 전부 실패(error 얼굴)와 구분된다.
    expect(screen.queryByTestId('explore-places-error')).toBeNull();
  });

  it('배너의 "다시 시도"를 누르면 지역별 재조회가 실제로 다시 나간다 (AC-6, 스텁 금지)', async () => {
    setAccessToken('valid-access');
    usePartialFailureHandler();

    render(<PlaceExplorePage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(
        screen.getByTestId('explore-places-partialfailure')
      ).toBeOnTheScreen()
    );

    // 누르기 전 앵커 — 다지역 fan-out 은 지역당 1건씩 정확히 2건(P-9 가 이미 실행으로 확정).
    // 이게 없으면 아래 "4건"이 재요청인지 최초 2번인지 구분이 안 된다.
    expect(hitsOf('GET', '/api/v1/places')).toHaveLength(2);

    fireEvent.press(screen.getByTestId('explore-places-partialfailure-retry'));

    // refetch 1회 = queryFn 1회 재실행 = allSettled 가 지역당 1건씩 = +2 → 총 4건.
    // onRetry 가 refetch 에 실제로 물려 있어야만(스텁이면) 새 요청이 나간다.
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(4)
    );
  });
});
