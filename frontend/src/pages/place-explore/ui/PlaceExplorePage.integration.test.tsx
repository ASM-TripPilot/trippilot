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
 *  - **P-3 (AC-7·AC-8)** 정렬·검색은 **서버를 다시 부르지 않는다**(히트수로 확인).
 *  - **P-4 (AC-4)** 하트를 누르면 **서버가 답하기 전에** 담김 표기와 CTA 숫자가 바뀐다.
 *  - **P-5 (AC-5)** 해제는 `savedPlaceId` 로 나가고, 0곳이 되면 CTA 바가 사라진다.
 *  - **P-6 (AC-6)** CTA 는 여행 생성 1/2 로 보낸다.
 *  - **P-7 (Seed Q1·BR-U1-03)** 게스트는 담은 목록 조회조차 보내지 않는다.
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
let mockParams: { region?: string } = {};

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
      const category = new URL(request.url).searchParams.get('category');
      // 응답이 `{items, nextCursor}` 객체다(TRIP-503) — 배열이 아니다.
      return HttpResponse.json({
        items:
          category === null
            ? PLACES
            : PLACES.filter((place) => place.category === category),
        nextCursor: null,
      });
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
  });
});

describe('P-3 · 정렬·검색은 서버를 다시 부르지 않는다 (AC-7 · AC-8)', () => {
  it('목록은 savedCount 내림차순이고, 검색어를 넣어도 요청이 늘지 않는다', async () => {
    setAccessToken('valid-access');

    await renderPage();

    // 서버가 준 순서(p1..p5)가 아니라 savedCount 내림차순이다 — 리터럴로 적어 게이트①에서
    // 사람 눈에 보이게 한다(30·21·12·7·3).
    expect(cardTestIds()).toEqual([
      'explore-places-card-p2',
      'explore-places-card-p5',
      'explore-places-card-p1',
      'explore-places-card-p3',
      'explore-places-card-p4',
    ]);

    fireEvent.changeText(screen.getByTestId('explore-places-search'), '해변');

    await waitFor(() =>
      expect(cardTestIds()).toEqual(['explore-places-card-p2'])
    );
    // 계약에 `q` 파라미터가 없다 — 검색은 받아온 목록 안에서 끝나야 한다.
    expect(hitsOf('GET', '/api/v1/places')).toHaveLength(1);
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
