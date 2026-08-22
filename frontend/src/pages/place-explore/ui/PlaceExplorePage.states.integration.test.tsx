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
 * AC-4 · AC-5 · AC-6 · AC-7 · AC-9 · AC-10 · AC-11 · AC-12 · AC-13 (+ 01b Seed Q4·Q5·Q6·Q7·Q12)
 * — d04 상태·예외의 **배선**.
 *
 * 무엇을 보장하나:
 *  - **S-1 (AC-4)** 첫 조회 중에는 스켈레톤이 뜨고, 응답이 오면 카드로 바뀐다.
 *  - **S-2 (AC-5)** 0건이면 안내가 뜨고 `다른 지역 보기`가 지역 선택으로 보낸다.
 *  - **S-3 (AC-6)** 검색어가 0건을 만들면 그 검색어를 지목하고, 해제가 실제로 되돌린다.
 *  - **S-4 (AC-7)** 조회 실패 안내의 `다시 시도`가 **실제로 서버를 다시 부른다**(스텁 금지).
 *  - **S-5 (AC-9)** 미로그인 담기는 **요청을 보내지 않고** 로그인 유도로 보낸다(BR-U1-03).
 *  - **S-6 (AC-10)** 404 는 낙관 반영을 롤백하고 사유를 알린다. 실패 경로에서 무효화하지 않는다.
 *  - **S-7 (AC-11)** 409 는 오류를 **발명하지 않고** 담김으로 수렴한다.
 *  - **S-8 (AC-12)** 네트워크 실패는 롤백 + 재시도이고, 재시도가 같은 담기를 다시 보낸다.
 *  - **S-9 (AC-13)** 응답 대기 중 같은 하트를 다시 눌러도 조작이 유실되지 않는다.
 *  - **S-10 (Seed Q5)** 배너는 **다음 조작 시** 사라진다 — 타이머를 쓰지 않는다.
 *  - **S-11 (Seed Q12)** 좌표 방어 배선 — 계약이 만들 수 없는 응답을 손으로 만들어 확인한다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 나간 요청**"이다. 요청 유무·재요청 횟수·무효화 여부는
 * msw 만 관찰할 수 있다(`PlaceExplorePage.integration.test.tsx` 계승).
 *
 * ★ 낙관 단언의 비결정성을 두 겹으로 막는다. ① 응답을 **문(gate) 뒤**에 세워 "응답 전"을 시간이
 *   아니라 신호로 만든다. ② 담은 목록 목을 **상태 있는 배열**로 둬 재조회가 언제 와도 답이 낙관
 *   반영과 같게 한다. 단언은 `waitFor` 로 감싼다(TanStack Query 통지가 매크로태스크를 한 칸 거친다).
 * ★ 실패 경로는 무효화하지 않는다(TRIP-220 동결 계약) — 그래서 `GET /saved-places` 히트수가
 *   "롤백이냐 재조회냐"를 가르는 신호가 된다. 반대로 409 는 성공 수렴이라 무효화한다.
 */

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

// ★ `router.push` 를 화살표로 한 겹 감싸 **지연 참조**한다. `jest.mock` 팩토리는 hoist 되어
// `const mockPush` 선언보다 먼저 도는데, `push: mockPush` 로 즉시 읽으면 그 시점의 undefined 가
// 박혀 `router.push is not a function` 이 난다(TRIP-221 실측 ★16).
jest.mock('expo-router', () => ({
  router: { push: (href: string) => mockPush(href) },
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({}),
}));

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

/** 테스트가 풀어 줄 때까지 응답하지 않는 문(리포 선례). `delay(ms)` 로 재면 느린 CI 에서
 * 흔들리고 "아직 안 왔다"를 결정론적으로 보장하지 못한다. */
function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

let savedRows: SavedPlace[] = [];
let placesGate = createGate();
let saveGate = createGate();
let observed: { method: string; url: string }[] = [];

function hitsOf(method: string, pathname: string) {
  return observed.filter(
    (hit) => hit.method === method && new URL(hit.url).pathname === pathname
  );
}

function cardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^explore-places-card-/)
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
  mockPush.mockClear();
  clearAccessToken();
  // 두 문 다 기본은 열려 있다 — "응답 전"을 재는 케이스만 닫힌 문으로 갈아 끼운다.
  placesGate = createGate();
  placesGate.release();
  saveGate = createGate();
  saveGate.release();

  server.use(
    http.get(`${BASE}/places`, async ({ request }) => {
      await placesGate.opened;
      // 서버가 q(이름 부분일치)로 거른다(TRIP-502) — 검색은 서버 몫이라 이 스텁도 q 를 반영한다.
      const q = new URL(request.url).searchParams.get('q');
      const result = q ? PLACES.filter((p) => p.nameKo.includes(q)) : PLACES;
      return HttpResponse.json({ items: result, nextCursor: null });
    }),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(savedRows)),
    http.post(`${BASE}/saved-places`, async ({ request }) => {
      await saveGate.opened;
      const body = (await request.json()) as { poiId: string };
      const row = savedRowOf(body.poiId);
      savedRows = [...savedRows, row];
      return HttpResponse.json(row, { status: 201 });
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

function renderPage() {
  render(<PlaceExplorePage />, { wrapper: createWrapper() });
}

/** 목록이 도착해 카드가 그려진 상태까지 만든다. */
async function renderLoaded() {
  renderPage();
  await waitFor(() =>
    expect(
      screen.getAllByTestId(/^explore-places-card-/).length
    ).toBeGreaterThan(0)
  );
}

describe('S-1 · 첫 조회 중에는 스켈레톤이 뜬다 (AC-4)', () => {
  it('응답 전에는 스켈레톤 4장이고, 응답이 오면 카드로 바뀐다', async () => {
    setAccessToken('valid-access');
    placesGate = createGate(); // 이 시점부터 GET /places 는 문 뒤에 선다

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-loading')).toBeOnTheScreen()
    );
    expect(screen.getAllByTestId(/^explore-places-skeleton-/)).toHaveLength(4);
    expect(cardTestIds()).toEqual([]);

    placesGate.release();

    await waitFor(() => expect(cardTestIds()).toHaveLength(5));
    // 스켈레톤이 카드와 함께 남아 있으면 화면이 두 얼굴을 동시에 보인다.
    expect(screen.queryByTestId('explore-places-loading')).toBeNull();
  });
});

describe('S-2 · 0건이면 다른 지역으로 보낸다 (AC-5 · 01b Seed Q4)', () => {
  it('안내가 뜨고 "다른 지역 보기"가 여행 목적 지역 선택으로 보낸다', async () => {
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/places`, () =>
        HttpResponse.json({ items: [], nextCursor: null })
      )
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-empty')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('explore-places-empty-region'));

    // d04 는 여행지 맥락이다(01b Seed Q4 ⓐ) — 숙소 기본값으로 보내면 사용자가 다른 흐름에 떨어진다.
    expect(mockPush.mock.calls).toEqual([['/explore/region?purpose=trip']]);
  });
});

describe('S-3 · 검색어가 0건을 만들면 그 검색어를 지목한다 (AC-6 · BR-U1-16 취지)', () => {
  it('검색어를 문구에 박고, 해제하면 목록이 되돌아온다 (검색은 서버가 한다 — TRIP-502)', async () => {
    setAccessToken('valid-access');

    await renderLoaded();

    fireEvent.changeText(
      screen.getByTestId('explore-places-search'),
      '없는이름'
    );

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-filterzero')).toBeOnTheScreen()
    );
    expect(
      within(screen.getByTestId('explore-places-filterzero')).getByText(
        '‘없는이름’ 때문에 0건이에요'
      )
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('explore-places-filterzero-clear'));

    // 해제 수단이 실제로 조건을 지운다 — 문구만 있고 버튼이 아무 일도 안 하면 no-op 컨트롤이다.
    await waitFor(() => expect(cardTestIds()).toHaveLength(5));
    // 검색·해제는 서버가 한다(q) — 각각 새 요청이 나간다(초기 + 검색 + 해제, 로드된 페이지 한정 아님).
    expect(hitsOf('GET', '/api/v1/places').length).toBeGreaterThanOrEqual(2);
  });
});

describe('S-4 · 조회 실패의 재시도가 실제로 서버를 다시 부른다 (AC-7 · INV-4)', () => {
  it('에러 안내가 뜨고, 다시 시도를 누르면 재조회해 목록이 온다', async () => {
    setAccessToken('valid-access');
    let attempts = 0;
    server.use(
      http.get(`${BASE}/places`, () => {
        attempts += 1;
        return attempts === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ items: PLACES, nextCursor: null });
      })
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-error')).toBeOnTheScreen()
    );
    // 빈 목록으로 위장하면 위반이다(INV-4).
    expect(cardTestIds()).toEqual([]);

    fireEvent.press(screen.getByTestId('explore-places-error-retry'));

    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(2)
    );
    // 재조회 결과가 화면에 닿았다 — 히트수만 보면 "부르고 버리는" 구현도 통과한다.
    await waitFor(() => expect(cardTestIds()).toHaveLength(5));
    expect(screen.queryByTestId('explore-places-error')).toBeNull();
  });
});

describe('S-5 · 미로그인 담기 (AC-9 · BR-U1-03)', () => {
  it('요청을 보내지 않고, 로그인 유도 배너로 로그인 화면에 보낸다', async () => {
    // 토큰 없음 — 목록 열람은 미로그인도 가능한 화면이다.
    await renderLoaded();

    fireEvent.press(screen.getByTestId('explore-places-save-p2'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-saveerror')).toBeOnTheScreen()
    );
    expect(
      within(screen.getByTestId('explore-places-saveerror')).getByText(
        '로그인하면 마음에 든 장소를 담을 수 있어요'
      )
    ).toBeOnTheScreen();

    // 규칙의 본체 — 요청 자체가 나가지 않는다. 낙관 반영도 하지 않는다.
    expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(0);
    expect(
      within(screen.getByTestId('explore-places-card-p2')).queryAllByText(
        '담음'
      )
    ).toHaveLength(0);
    expect(screen.getByTestId('explore-places-save-p2')).not.toBeSelected();

    fireEvent.press(screen.getByTestId('explore-places-saveerror-login'));

    // 01b Seed Q6 ⓒ — 배너만 두면 목적지 없는 안내가 된다(관통 원칙: no-op 컨트롤 금지).
    expect(mockPush.mock.calls).toEqual([['/(auth)/login']]);
  });
});

describe('S-6 · 404 는 롤백하고 사유를 알린다 (AC-10 · INV-4)', () => {
  it('낙관 반영이 되돌려지고 배너가 뜨며, 실패 경로에서 재조회하지 않는다', async () => {
    setAccessToken('valid-access');
    server.use(
      http.post(
        `${BASE}/saved-places`,
        () => new HttpResponse(null, { status: 404 })
      )
    );

    await renderLoaded();
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(1);

    fireEvent.press(screen.getByTestId('explore-places-save-p2'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-saveerror')).toBeOnTheScreen()
    );
    expect(
      within(screen.getByTestId('explore-places-saveerror')).getByText(
        '지금은 담을 수 없는 장소예요'
      )
    ).toBeOnTheScreen();

    // 롤백 — 티켓의 "카드 상태 갱신"은 재조회가 아니라 되돌리기다.
    expect(
      within(screen.getByTestId('explore-places-card-p2')).queryAllByText(
        '담음'
      )
    ).toHaveLength(0);
    expect(screen.getByTestId('explore-places-save-p2')).not.toBeSelected();
    expect(screen.queryByTestId('explore-places-createtrip')).toBeNull();

    // 실패 경로에서 무효화하면 되돌린 것이 롤백 때문인지 재조회 때문인지 구별할 수 없어진다.
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(1);
    expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(1);

    // 다시 눌러도 결과가 같은 실패다 — 재시도 버튼을 달면 no-op 컨트롤이 된다.
    expect(screen.queryByTestId('explore-places-saveerror-retry')).toBeNull();
    expect(screen.queryByTestId('explore-places-saveerror-login')).toBeNull();
  });
});

describe('S-7 · 409 는 오류를 발명하지 않는다 (AC-11)', () => {
  it('배너 없이 담김을 유지하고, 서버 진실로 한 번 맞춰 본다', async () => {
    setAccessToken('valid-access');
    server.use(
      http.post(`${BASE}/saved-places`, async ({ request }) => {
        // 이미 담겨 있던 상태(클라 캐시가 낡았을 때 나는 갈래) — 서버 쪽 진실을 채워 둔다.
        const body = (await request.json()) as { poiId: string };
        savedRows = [savedRowOf(body.poiId)];
        return new HttpResponse(null, { status: 409 });
      })
    );

    await renderLoaded();

    fireEvent.press(screen.getByTestId('explore-places-save-p2'));

    // 목표 상태와 결과 상태가 같다(INV-U1-04) — 실패가 아니라 담김으로 수렴한다.
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(2)
    );
    expect(screen.queryByTestId('explore-places-saveerror')).toBeNull();
    expect(
      within(screen.getByTestId('explore-places-card-p2')).getByText('담음')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('explore-places-save-p2')).toBeSelected();
  });
});

describe('S-8 · 네트워크 실패는 롤백 + 재시도다 (AC-12)', () => {
  it('사유와 재시도를 주고, 재시도가 같은 담기를 다시 보낸다', async () => {
    setAccessToken('valid-access');
    let attempts = 0;
    server.use(
      http.post(`${BASE}/saved-places`, async ({ request }) => {
        attempts += 1;
        if (attempts === 1) return HttpResponse.error();
        const body = (await request.json()) as { poiId: string };
        const row = savedRowOf(body.poiId);
        savedRows = [...savedRows, row];
        return HttpResponse.json(row, { status: 201 });
      })
    );

    await renderLoaded();

    fireEvent.press(screen.getByTestId('explore-places-save-p2'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-saveerror')).toBeOnTheScreen()
    );
    expect(
      within(screen.getByTestId('explore-places-saveerror')).getByText(
        '연결이 불안정해 담지 못했어요'
      )
    ).toBeOnTheScreen();
    expect(screen.getByTestId('explore-places-save-p2')).not.toBeSelected();

    fireEvent.press(screen.getByTestId('explore-places-saveerror-retry'));

    await waitFor(() =>
      expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(2)
    );
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-save-p2')).toBeSelected()
    );
    // 성공했으면 실패 배너가 남아 있으면 안 된다(다음 조작 시 사라진다 — 01b Seed Q5).
    expect(screen.queryByTestId('explore-places-saveerror')).toBeNull();
  });
});

describe('S-9 · 응답 대기 중 연타 (AC-13 · 01b Seed Q7 ⓑ)', () => {
  it('두 번째 누름이 유실되지 않고, 담기가 정확히 한 번만 나간다', async () => {
    setAccessToken('valid-access');
    saveGate = createGate(); // POST 를 문 뒤에 세운다

    await renderLoaded();

    fireEvent.press(screen.getByTestId('explore-places-save-p2'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-save-p2')).toBeDisabled()
    );

    // 응답 전 두 번째 누름 — 예전에는 여기서 해제 경로로 새어 조작이 조용히 사라졌다
    // (TRIP-221 03b W-2). 눌리지 않게 만들어 그 자리 자체를 없앤다.
    fireEvent.press(screen.getByTestId('explore-places-save-p2'));
    expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(1);

    saveGate.release();

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-save-p2')).not.toBeDisabled()
    );
    expect(screen.getByTestId('explore-places-save-p2')).toBeSelected();
    expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(1);
    // 유실도 없고 침묵도 없다 — 알릴 실패가 없으므로 배너도 없다.
    expect(screen.queryByTestId('explore-places-saveerror')).toBeNull();
  });
});

describe('S-10 · 배너는 다음 조작 시 사라진다 (01b Seed Q5 — 타이머 금지)', () => {
  it('실패 배너가 뜬 뒤 검색어를 바꾸면 배너가 사라진다', async () => {
    setAccessToken('valid-access');
    server.use(
      http.post(
        `${BASE}/saved-places`,
        () => new HttpResponse(null, { status: 404 })
      )
    );

    await renderLoaded();
    fireEvent.press(screen.getByTestId('explore-places-save-p2'));
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-saveerror')).toBeOnTheScreen()
    );

    fireEvent.changeText(screen.getByTestId('explore-places-search'), '광안');

    // 가짜 타이머를 들이면 이 칸의 상태 판정 전체가 타이밍 의존이 된다 — 조작이 지운다.
    await waitFor(() =>
      expect(screen.queryByTestId('explore-places-saveerror')).toBeNull()
    );
    // 긍정 짝 — 화면이 통째로 죽어서 "없음"이 된 게 아니다. 검색은 서버가 하므로(q=광안, TRIP-502)
    // 새 조회가 해소되면 p2 만 남는다(클라 즉시 필터 아님 — waitFor 로 서버 응답을 기다린다).
    await waitFor(() =>
      expect(cardTestIds()).toEqual(['explore-places-card-p2'])
    );
  });
});

describe('S-11 · 좌표 방어 배선 (01b Seed Q12 · BR-U1-02 · US-EXPL-04 예외)', () => {
  it('좌표를 확인할 수 없는 장소는 담기를 막고 사유를 표시한다', async () => {
    setAccessToken('valid-access');

    // ⚠️ 이 응답은 **계약상 존재할 수 없다** — `openapi.yaml` 의 `Place` 는 `lat`·`lng` 가
    // required 이고 nullable 이 아니며 `GET /places` 는 ACTIVE POI 만 준다. 캐스팅을 해야
    // 만들어진다는 사실 자체가 "US-EXPL-04 예외 AC 는 현재 계약에서 재현 불가"의 증거다
    // (미충족으로 기록한다). 그럼에도 방어 코드는 두고, 이 케이스가 그 배선의 심판이다.
    const noCoords = {
      ...PLACES[1],
      lat: null,
      lng: null,
    } as unknown as Place;
    server.use(
      http.get(`${BASE}/places`, () =>
        HttpResponse.json({ items: [noCoords], nextCursor: null })
      )
    );

    await renderLoaded();

    fireEvent.press(screen.getByTestId('explore-places-save-p2'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-saveerror')).toBeOnTheScreen()
    );
    expect(
      within(screen.getByTestId('explore-places-saveerror')).getByText(
        '위치를 확인할 수 없어 담을 수 없어요'
      )
    ).toBeOnTheScreen();

    // 서버 판정을 기다리지 않고 클라가 먼저 막는다(BR-U1-02 는 UX 사본이고 정본은 서버다).
    expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(0);
    expect(
      within(screen.getByTestId('explore-places-card-p2')).queryAllByText(
        '담음'
      )
    ).toHaveLength(0);
  });
});
