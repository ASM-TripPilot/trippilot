import { http, HttpResponse } from 'msw';
import { onlineManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import {
  getGetPlacesQueryKey,
  getGetTripsQueryKey,
} from '@/shared/api/index.hooks';
import type { Place, Trip } from '@/shared/api/index.schemas';
import { BASE } from '@/test-support/apiBase';
import {
  createClockSkew,
  newTestQueryClient,
  renderWithQueryClient,
  settle,
} from '@/test-support/queryRender';

import { HomePage } from './HomePage';

/**
 * TRIP-1638 · 홈 — 오프라인으로 처음 켜면(캐시 없음) 전면 스켈레톤이 영원히 남고 그 아래 레인도 꺼진 채 스켈레톤이던 문제(INV-4).
 *
 * 무엇을 보장하나:
 *  - 오프라인 + 빈 캐시 → 히어로 스켈레톤 대신 오류 배너 자리에 "인터넷에 연결되어 있지 않아요"(버튼 없음). 레인(지금 뜨는
 *    장소·요즘 담는 곳)도 스켈레톤·재시도 카드·가짜 카드로 남지 않는다. 요청은 한 건도 안 나갔다.
 *  - 온라인으로 돌아오면 사용자가 아무것도 안 해도 배너가 사라지고 레인이 평소대로 채워진다.
 *  - 받아 둔 목록이 있으면 오프라인이어도 그대로. 온라인 느림(fetching)·온라인 500 은 오프라인이 아니다.
 *  - 오류 배너 + [다시 시도] 가 떠 있다가 오프라인에서 눌러도 오프라인 배너가 이긴다(오류 판정보다 앞).
 *
 * 왜 새 통합 파일인가: 홈의 통합 버킷 파일이 없고, `HomePage.test.tsx` 는 조회 훅을 전부 목으로 갈아 끼워 `paused` 라는 실제 라이브러리
 * 상태를 만들 수 없다. 레이스(NetInfo 가 늦게 알림 → 요청 실패 뒤 paused)는 retry:false 클라이언트로 재현할 수 없다 — jest 사각, 6-b.
 * 알려진 경계: 여행 목록은 캐시에 있는데 레인 장소만 캐시에 없는 채 오프라인이면 레인이 보류 스켈레톤으로 남는다 — 이 칸 범위 밖.
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

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'replace', 'navigate'],
  })
);

const OFFLINE = 'home-trips-offline';
const TITLE_OFFLINE = '인터넷에 연결되어 있지 않아요';
const DESC_OFFLINE = '연결되면 자동으로 불러올게요';
const TRIPS_GET = 'GET /api/v1/trips';

/** 서비스 지역(서울·부산·제주) 각 4곳 = 12곳 — 앞 4장은 '지금 뜨는 장소', 다음 3장은 컬렉션 레인을 채우고도 남는다. */
function place(poiId: string, region: string, savedCount: number): Place {
  return {
    poiId,
    nameKo: `장소 ${poiId}`,
    category: '명소',
    lat: 35.1,
    lng: 129.0,
    region,
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount,
    dataStatus: 'ACTIVE',
  } as Place;
}
const PLACES_BY_REGION: Record<string, Place[]> = Object.fromEntries(
  ['서울', '부산', '제주'].map((region, r) => [
    region,
    [0, 1, 2, 3].map((i) => place(`${region}-${i}`, region, 100 - i * 10 - r)),
  ])
);

/** 나간 요청 `METHOD /경로` 누적. */
let hits: string[] = [];
const count = (needle: string): number =>
  hits.filter((hit) => hit === needle).length;
let tripsReplies: ('ok' | 500 | 'gate')[] = [];
let tripsGate: (() => void)[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    hits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  hits = [];
  tripsReplies = [];
  tripsGate = [];
  clearAccessToken();
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips`, async () => {
      const reply = tripsReplies.shift() ?? 'ok';
      if (reply === 500) {
        return HttpResponse.json(
          { error: { code: 'INTERNAL', message: '서버 오류' } },
          { status: 500 }
        );
      }
      if (reply === 'gate') {
        await new Promise<void>((resolve) => tripsGate.push(resolve));
      }
      return HttpResponse.json([] as Trip[]);
    }),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json([])),
    http.get(`${BASE}/places`, ({ request }) => {
      const region = new URL(request.url).searchParams.get('region') ?? '';
      return HttpResponse.json({
        items: PLACES_BY_REGION[region] ?? [],
        nextCursor: null,
      });
    })
  );
});

// onlineManager 는 모듈 싱글턴 — 오프라인 케이스가 어떻게 끝나든 다음 케이스는 온라인으로 시작한다(02a ★1, 파일 최상위).
afterEach(() => {
  onlineManager.setOnline(true);
  // 단언이 문을 열기 전에 실패해도 붙잡힌 요청을 남기지 않는다.
  const waiting = tripsGate;
  tripsGate = [];
  waiting.forEach((open) => open());
  server.resetHandlers();
});

afterAll(() => server.close());

function renderPage(seed?: Trip[]) {
  const client = newTestQueryClient({ gcTime: 0 });
  if (seed) client.setQueryData(getGetTripsQueryKey(), seed);
  return renderWithQueryClient(<HomePage />, client);
}

/** 오프라인으로 만든다. 앞 케이스의 오프라인이 새지 않았음을 먼저 확인한다. */
function goOffline(): void {
  expect(onlineManager.isOnline()).toBe(true);
  onlineManager.setOnline(false);
}

function axes(client: ReturnType<typeof renderPage>['client']) {
  const state = client.getQueryState(getGetTripsQueryKey());
  return { status: state?.status, fetchStatus: state?.fetchStatus };
}

/** 레인이 스켈레톤·재시도 카드·카드 어느 모양으로도 안 남았다(= 섹션이 접혔다). */
function expectLanesGone(): void {
  expect(screen.queryByTestId('home-spots-skeleton')).toBeNull();
  expect(screen.queryByTestId('home-collections-skeleton')).toBeNull();
  expect(screen.queryByTestId('home-spots-error')).toBeNull();
  expect(screen.queryByTestId('home-collections-error')).toBeNull();
  // 픽스처(HOME_DEFAULT_PROPS) 카드가 가짜로 비치지 않는다(02a ★9).
  expect(screen.queryAllByTestId(/^home-spot-card-/)).toHaveLength(0);
  expect(screen.queryAllByTestId(/^home-collection-card-/)).toHaveLength(0);
}

describe('TRIP-1638 · 홈 오프라인 콜드스타트', () => {
  it('H1 오프라인으로 처음 켜면 스켈레톤·레인 대신 오프라인 배너가 뜨고, 요청은 한 건도 안 나간다', async () => {
    // 준비
    goOffline();

    // 실행
    const { client } = renderPage();

    // 단언 — 배너가 먼저 도착해야 아래 "없음" 단언이 의미가 있다(02a ★4).
    const face = await screen.findByTestId(OFFLINE);
    expect(within(face).getByText(TITLE_OFFLINE)).toBeOnTheScreen();
    expect(within(face).getByText(DESC_OFFLINE)).toBeOnTheScreen();
    // 보류 요청에 refetch 는 무동작이다 — 버튼을 두면 "눌렀는데 아무 일도 없는" 새 침묵 실패(D4).
    expect(within(face).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByTestId('home-trips-error')).toBeNull();
    expect(screen.queryByTestId('home-trips-retry')).toBeNull();
    // 전면 스켈레톤은 걷히고, 홈 틀(인사·검색바)은 그대로다.
    expect(screen.queryByTestId('home-hero-skeleton')).toBeNull();
    expect(screen.getByTestId('home-greeting')).toBeOnTheScreen();
    expect(screen.getByTestId('home-search-bar')).toBeOnTheScreen();
    // AC-6 — 레인이 영구 스켈레톤으로 남지 않는다.
    expectLanesGone();
    // 증거 — 요청이 한 건도 안 나갔고(보류), 여행 목록은 못 받았다.
    expect(hits).toEqual([]);
    expect(axes(client)).toEqual({ status: 'pending', fetchStatus: 'paused' });
  });

  it('H2 온라인으로 돌아오면 사용자가 아무것도 안 해도 배너가 사라지고 레인이 채워진다', async () => {
    // 준비 — 오프라인 배너가 떠 있는 상태가 출발점(앵커).
    goOffline();
    renderPage();
    await screen.findByTestId(OFFLINE);
    expect(count(TRIPS_GET)).toBe(0);

    // 실행 — 입력 없이 연결만 돌아온다.
    act(() => {
      onlineManager.setOnline(true);
    });

    // 단언 — 복귀 후 화면 갱신은 비동기라 보일 때까지 기다린다(02a ★6). 레인이 굳어 숨지 않았음을 카드 도착으로 증명(★10).
    expect(await screen.findByTestId('home-spot-card-0')).toBeOnTheScreen();
    expect(screen.getByTestId('home-collection-card-0')).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
    await settle();
    expect(count(TRIPS_GET)).toBe(1);
  });

  it('H3 (선제 green) 받아 둔 목록이 있으면 오프라인이어도 오프라인 배너는 없다', async () => {
    // 준비 — 다른 탭이 이미 받아 둔 (빈) 여행 목록. 상태는 success + paused(데이터 있음 + 보류).
    goOffline();

    // 실행
    const { client } = renderPage([]);

    // 단언 — 홈 본문(히어로 캐러셀)이 서고 스켈레톤·배너는 없다. 레인은 이 칸의 범위 밖이라 보지 않는다.
    expect(await screen.findByTestId('home-hero-page-0')).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
    expect(screen.queryByTestId('home-hero-skeleton')).toBeNull();
    // 앵커 — "데이터가 있고 보류 중"이라는 바로 그 상태를 시험했다.
    await settle();
    expect(axes(client)).toEqual({ status: 'success', fetchStatus: 'paused' });
    expect(count(TRIPS_GET)).toBe(0);
  });

  it('H4 (선제 green) 온라인에서 응답이 느린 것은 오프라인이 아니다 — 전면 스켈레톤이 정상이고 배너는 없다', async () => {
    // 준비 — 응답을 붙잡아 fetching 상태를 만든다.
    tripsReplies = ['gate'];

    // 실행
    const { client } = renderPage();
    await waitFor(() => expect(count(TRIPS_GET)).toBe(1));

    // 단언 — 요청이 나가는 중이다(앵커: fetching ≠ paused).
    expect(axes(client)).toEqual({
      status: 'pending',
      fetchStatus: 'fetching',
    });
    expect(screen.getByTestId('home-hero-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();

    // 실행 — 응답이 오면 본문으로 바뀐다.
    act(() => {
      tripsGate.forEach((open) => open());
    });
    expect(await screen.findByTestId('home-hero-page-0')).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
    // 레인 응답이 테스트 뒤에 도착해 act 밖 갱신 경고를 내지 않게 흘려보낸다.
    await settle();
  });

  it('H5 (선제 green) 온라인 500 은 오프라인 배너가 아니라 기존 오류 배너다', async () => {
    // 준비
    tripsReplies = [500];

    // 실행
    renderPage();

    // 단언 — 오류 배너는 버튼이 하나(다시 시도)다: 같은 쿼리로 H1 의 "버튼 0" 이 항상 0 이 아님을 대조한다(02a ★5).
    const error = await screen.findByTestId('home-trips-error');
    expect(within(error).queryAllByRole('button')).toHaveLength(1);
    expect(screen.getByTestId('home-trips-retry')).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
    // 오류 배너 아래 레인 응답이 테스트 뒤에 도착해 act 밖 갱신 경고를 내지 않게 흘려보낸다.
    await settle();
  });

  it('H6 오류 배너가 떠 있다가 오프라인에서 다시 시도를 눌러도 오류 배너가 아니라 오프라인 배너가 이긴다 — 요청은 늘지 않는다', async () => {
    // 준비 — 온라인 500 으로 오류 배너(앵커: 여행 목록 히트 1).
    tripsReplies = [500];
    renderPage();
    await screen.findByTestId('home-trips-error');
    expect(count(TRIPS_GET)).toBe(1);

    // 실행 — 연결이 끊긴 채 다시 시도. 데이터 없는 쿼리의 refetch 는 status 를 pending 으로 되돌려 isError 가 거짓이 된다.
    act(() => {
      onlineManager.setOnline(false);
    });
    fireEvent.press(screen.getByTestId('home-trips-retry'));

    // 단언 — 판독이 오류 분기보다 앞이어야 보인다(02a ★7). 레인도 스켈레톤으로 남지 않는다.
    const face = await screen.findByTestId(OFFLINE);
    expect(within(face).getByText(TITLE_OFFLINE)).toBeOnTheScreen();
    expect(screen.queryByTestId('home-trips-error')).toBeNull();
    expect(screen.queryByTestId('home-trips-retry')).toBeNull();
    expect(screen.queryByTestId('home-hero-skeleton')).toBeNull();
    expectLanesGone();
    await settle();
    expect(count(TRIPS_GET)).toBe(1);
  });
});

/**
 * TRIP-1713 · 홈 장소 레인 캐시 정책 — 레인 카드 7장을 고르려고 받는 `GET /places` 를 10분 동안 재사용한다.
 *
 * 무엇을 보장하나: 홈을 다시 열었을 때(① 30초는 넘고 10분은 안 넘음) 장소를 다시 받지 않고 캐시로 카드를 그린다(여행 없음 3지역·여행 중 1지역 모두),
 * ② 10분을 넘기면 다시 받는다(무한 캐시 아님), ③ 하트 담기가 남기는 "낡음 표시"는 10분 안에서도 재조회를 낳는다(기존 그대로).
 * 개념: **재마운트** = 화면을 닫았다가 같은 캐시 저장소로 다시 여는 것. 새로 붙는 화면은 "내 staleTime(신선 유지 시간)보다 오래된
 * 데이터면 다시 받는다" — 그 staleTime 을 홈이 10분으로 주는지가 심판 대상. 시계는 `Date.now` 만 감는다(02a ★3).
 * 전역 기본 30초는 앱(`AppProviders`)과 같게 클라이언트에 심는다 — 안 심으면 기본 0 이라 변경 전후 차이가 안 보인다(02a ★2).
 */
describe('TRIP-1713 · 홈 장소 레인 캐시 정책', () => {
  const PLACES_GET = 'GET /api/v1/places';
  const MIN = 60_000;
  const GLOBAL_STALE = 30_000; // AppProviders.tsx 의 전역 staleTime 과 같다.
  const DURING_TRIP = {
    tripId: '33333333-3333-3333-3333-333333333333',
    title: '부산 여행',
    startDate: '2020-01-01',
    endDate: '2099-12-31',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 3 }],
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
  } as Trip;

  let clock: ReturnType<typeof createClockSkew>;
  let placeQueries: { region: string | null; limit: string | null }[] = [];

  beforeEach(() => {
    clock = createClockSkew();
    placeQueries = [];
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const url = new URL(request.url);
        const region = url.searchParams.get('region');
        placeQueries.push({ region, limit: url.searchParams.get('limit') });
        return HttpResponse.json({
          items: PLACES_BY_REGION[region ?? ''] ?? [],
          nextCursor: null,
        });
      })
    );
  });
  afterEach(() => clock.restore());

  /** 여행 중 홈 — 지배 여행의 일정 조회(CTA 목적지용)는 "아직 일정 없음"(404)으로 답한다. */
  function duringTrip(): void {
    server.use(
      http.get(`${BASE}/trips`, () => HttpResponse.json([DURING_TRIP])),
      http.get(
        `${BASE}/trips/:tripId/itinerary`,
        () => new HttpResponse(null, { status: 404 })
      )
    );
  }

  /** 홈을 열어 레인 카드가 그려질 때까지 기다린 뒤 닫는다(캐시는 남는다). */
  async function openAndClose(client: ReturnType<typeof newTestQueryClient>) {
    const view = renderWithQueryClient(<HomePage />, client);
    expect(await screen.findByTestId('home-spot-card-0')).toBeOnTheScreen();
    await settle();
    view.unmount();
  }
  /** 같은 캐시 저장소로 다시 연다. 이 시점부터의 요청만 세도록 기록을 비운다. */
  async function reopen(client: ReturnType<typeof newTestQueryClient>) {
    hits = [];
    placeQueries = [];
    renderWithQueryClient(<HomePage />, client);
    expect(await screen.findByTestId('home-spot-card-0')).toBeOnTheScreen();
    await settle();
  }
  const newClient = () => newTestQueryClient({ staleTime: GLOBAL_STALE });

  it('HC1 (선제 green) 여행이 없으면 첫 진입에 GET /places 는 서울·부산·제주 3건, 각 limit=200', async () => {
    // 준비 → 실행
    await openAndClose(newClient());

    // 단언 — 변경 전후 같은 측정값(PR 표에 쓸 값).
    expect(count(PLACES_GET)).toBe(3);
    expect(placeQueries.map((q) => q.region).sort()).toEqual(
      ['부산', '서울', '제주'].sort()
    );
    expect(placeQueries.every((q) => q.limit === '200')).toBe(true);
  });

  it('HC2 (선제 green) 여행 중이면 첫 진입에 GET /places 는 첫 목적지(부산) 1건, limit=200', async () => {
    // 준비
    duringTrip();

    // 실행
    await openAndClose(newClient());

    // 단언
    expect(count(PLACES_GET)).toBe(1);
    expect(placeQueries).toEqual([{ region: '부산', limit: '200' }]);
  });

  it('HC3 30초는 넘고 10분 안에 홈을 다시 열면 GET /places 를 다시 받지 않고 카드 4+3장을 캐시로 그린다', async () => {
    // 준비 — 첫 진입으로 3지역을 받아 둔다(앵커: 3건).
    const client = newClient();
    await openAndClose(client);
    expect(count(PLACES_GET)).toBe(3);

    // 실행 — 5분 뒤 다시 연다.
    clock.advance(5 * MIN);
    await reopen(client);

    // 단언 — 새 요청 0건인데 카드는 앞 4 + 다음 3장(INV-4: 얼굴 불변).
    expect(count(PLACES_GET)).toBe(0);
    expect(screen.getAllByTestId(/^home-spot-card-\d+$/)).toHaveLength(4);
    expect(screen.getAllByTestId(/^home-collection-card-\d+$/)).toHaveLength(3);
  });

  it('HC4 (선제 green) 10분을 넘기고 다시 열면 3지역을 다시 받는다 — 무한 캐시가 아니다', async () => {
    // 준비
    const client = newClient();
    await openAndClose(client);

    // 실행
    clock.advance(10 * MIN + 1000);
    await reopen(client);

    // 단언
    expect(count(PLACES_GET)).toBe(3);
  });

  it('HC5 여행 중 1지역도 같은 정책이다 — 10분 안에는 0건, 10분을 넘기면 1건', async () => {
    // 준비
    duringTrip();
    const client = newClient();
    await openAndClose(client);
    expect(count(PLACES_GET)).toBe(1);

    // 실행·단언 ① — 5분 뒤: 다시 받지 않는다(재조회가 없으니 받은 시각은 그대로).
    clock.advance(5 * MIN);
    await reopen(client);
    expect(count(PLACES_GET)).toBe(0);

    // 실행·단언 ② — 첫 응답 기준 10분 1초(5분 1초 더): 다시 받는다.
    clock.advance(5 * MIN + 1000);
    await reopen(client);
    expect(count(PLACES_GET)).toBe(1);
  });

  it('HC6 (선제 green) 하트 담기가 남기는 낡음 표시가 있으면 10분 안이어도 여행 중 1지역은 다시 받는다', async () => {
    // 준비 — savedPlaces.invalidateBoth 가 하는 것: 즉시 재조회 없이 낡음 표시만(refetchType 'none').
    duringTrip();
    const client = newClient();
    await openAndClose(client);
    await client.invalidateQueries({
      queryKey: getGetPlacesQueryKey(),
      refetchType: 'none',
    });

    // 실행 — 5초 뒤(전역 30초·새 10분 어느 쪽으로도 신선) 다시 연다.
    clock.advance(5000);
    await reopen(client);

    // 단언 — 낡음 표시 때문에만 다시 받는다.
    expect(count(PLACES_GET)).toBe(1);
  });
});
