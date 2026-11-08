import { http, HttpResponse } from 'msw';
import { onlineManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { ITINERARY_OPEN_FAILED_TOAST_ID } from '@/features/itinerary';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import {
  getGetPlacesQueryKey,
  getGetSavedPlacesQueryKey,
  getGetTripsQueryKey,
} from '@/shared/api/index.hooks';
import type {
  Itinerary,
  Place,
  SavedPlace,
  SavedStay,
  Trip,
} from '@/shared/api/index.schemas';
import { BASE } from '@/test-support/apiBase';
import { createGate } from '@/test-support/mswHookHarness';
import { expectTypeOnePhotoDelivered } from '@/test-support/poiPhotoProbe';
import { routerSpies } from '@/test-support/expoRouterMock';
import {
  day,
  itinerary as itineraryFixture,
  slot,
  trip as tripFixture,
} from '@/test-support/itineraryFixtures';
import {
  createClockSkew,
  createWrapper,
  newTestQueryClient,
  renderWithQueryClient,
  settle,
} from '@/test-support/queryRender';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';
import {
  NO_ITINERARY,
  itineraryCols,
  itineraryHits,
  listHits,
} from '@/test-support/tripItineraryCols';

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

/** 서울·부산·제주 각 4곳 = 12곳(새 3시도는 0건) — 앞 4장은 '지금 뜨는 장소', 다음 3장은 컬렉션 레인을 채우고도 남는다. */
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
/** 서버가 내려 주는 목록 본문 — 기본은 여행 없음(TRIP-1638 케이스들이 그대로 쓴다). */
let tripsBody: Trip[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    hits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  hits = [];
  tripsBody = [];
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
      return HttpResponse.json(tripsBody);
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
  // 토스트 스토어·연타 창은 모듈 싱글턴 — 파일 최상위에서 비운다(02a ★2).
  resetToast();
  resetPressGuard();
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

  it('HC1 여행이 없으면 첫 진입에 GET /places 는 서비스 지역 6건, 각 limit=200 (TRIP-1807)', async () => {
    // 준비 → 실행
    await openAndClose(newClient());

    // 단언 — 변경 전후 같은 측정값(PR 표에 쓸 값).
    expect(count(PLACES_GET)).toBe(6);
    expect(placeQueries.map((q) => q.region).sort()).toEqual(
      ['강원', '경남', '경북', '부산', '서울', '제주'].sort()
    );
    expect(placeQueries.every((q) => q.limit === '200')).toBe(true);
  });

  it('HC1b 담긴 수가 같으면 뜨는 장소·컬렉션 7장이 6지역을 번갈아 강원·경북·경남도 나온다 (TRIP-1807)', async () => {
    // 준비 — 6지역 모두 사진 있는 장소 2곳, 담긴 수 0.
    const CODE: Record<string, string> = {
      서울: '11110',
      부산: '26350',
      제주: '50110',
      강원: '51110',
      경북: '47130',
      경남: '48120',
    };
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region') ?? '';
        return HttpResponse.json({
          items: [0, 1].map((i) => ({
            ...place(`${region}-${i}`, region, 0),
            regionCode: CODE[region],
            imageUrl: `https://img.example/${region}-${i}.jpg`,
          })),
          nextCursor: null,
        });
      })
    );

    // 실행
    renderWithQueryClient(<HomePage />, newClient());
    await screen.findByTestId('home-collection-card-2');

    // 단언 — 뜨는 장소 4칸의 마지막이 강원, 컬렉션 앞 두 칸이 경북·경남이다.
    expect(
      within(screen.getByTestId('home-spot-card-3')).getByText('장소 강원-0')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('home-collection-card-0')).getByText(
        '장소 경북-0'
      )
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('home-collection-card-1')).getByText(
        '장소 경남-0'
      )
    ).toBeOnTheScreen();
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
    // 준비 — 첫 진입으로 서비스 지역을 받아 둔다(앵커: 6건).
    const client = newClient();
    await openAndClose(client);
    expect(count(PLACES_GET)).toBe(6);

    // 실행 — 5분 뒤 다시 연다.
    clock.advance(5 * MIN);
    await reopen(client);

    // 단언 — 새 요청 0건인데 카드는 앞 4 + 다음 3장(INV-4: 얼굴 불변).
    expect(count(PLACES_GET)).toBe(0);
    expect(screen.getAllByTestId(/^home-spot-card-\d+$/)).toHaveLength(4);
    expect(screen.getAllByTestId(/^home-collection-card-\d+$/)).toHaveLength(3);
  });

  it('HC4 10분을 넘기고 다시 열면 6지역을 다시 받는다 — 무한 캐시가 아니다', async () => {
    // 준비
    const client = newClient();
    await openAndClose(client);

    // 실행
    clock.advance(10 * MIN + 1000);
    await reopen(client);

    // 단언
    expect(count(PLACES_GET)).toBe(6);
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

/**
 * TRIP-1677 · 홈 지배 여행의 일정 상태는 `GET /trips` 의 네 칸에서 읽는다 — 진입에서 일정 GET 0, CTA 는 첫 프레임부터 활성.
 * 같이 짜기(CO_PLAN) 생성 중 카드/CTA 를 *누를 때만* 일정을 한 번 묻는다(첫 비고정 슬롯 주소를 만들려면 `days` 가 필요).
 *
 * 무엇을 보장하나:
 *  - 진입: 목록 GET 1 · 일정 GET 0 (생성 중 FULLY_AI / CO_PLAN / 확정 / 일정 없음 모두).
 *  - copick 누름: 응답 전 이동 0 → 응답 뒤 `copick/<인코딩된 첫 비고정 슬롯>` push 1 · 일정 GET 1. 같은 틱 연타·창이 닫힌 뒤의 재누름도 요청 1.
 *    응답이 그사이 COMPLETE+CO_PLAN 이면 `copick/complete`, 404 면 method(재판정). 500 이면 이동 0 + 실패 토스트, 다시 누르면 다시 시도.
 *  - 비 copick(FULLY_AI 생성 중·확정)은 누름에서도 일정 GET 0, 즉시 이동.
 *
 * 3동작 뼈대: 준비 = 서버 목록(네 칸)·일정 대본 → 실행 = 렌더(+CTA 누름) → 단언 = 요청 수·push.
 * jest 사각: 지금 이 시계로 실제 연타(두 손가락)·실제 터치는 6-b.
 */
describe('TRIP-1677 · 홈 지배 여행 — 목록 칸으로 읽고, copick 누름에서만 일정을 묻는다', () => {
  const TRIP_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const { push: mockPush } = routerSpies;
  const CTA = 'home-trip-hero-cta';

  type Reply = Itinerary | 404 | 500;
  let itinReply: Reply = 404;
  /** 'gate' 면 일정 응답을 붙잡는다 — "응답 전 이동 0" 과 "응답 대기 중 재누름" 을 보려고. */
  let itinGated = false;
  let itinGates: (() => void)[] = [];

  /** 2099-06-10 첫 슬롯은 고정 숙소, 둘째가 첫 비고정(poi-1), 셋째 poi-2. */
  const COPICK_DAYS = [
    day('2099-06-10', [
      slot('hotel', { isFixed: true, startAt: '00:00:00', endAt: '00:00:00' }),
      slot('poi-1'),
      slot('poi-2', { startAt: '13:00:00', endAt: '14:00:00' }),
    ]),
  ];
  const FIRST_SLOT = `/trips/${TRIP_ID}/itinerary/copick/${encodeURIComponent('2099-06-10#poi-1')}`;

  const copickRunning = itineraryFixture({
    tripId: TRIP_ID,
    status: 'PLANNED',
    generationMode: 'CO_PLAN',
    generationState: 'PARTIAL',
    generationSessionId: 'sess-1',
    days: COPICK_DAYS,
  });

  /** 지배(여행 전 계획 중) 여행 하나 — 네 칸은 일정 응답 모양에서 서버 규칙대로 옮긴다. */
  function planningTrip(cols: Partial<Trip>): Trip {
    return tripFixture({
      tripId: TRIP_ID,
      title: '부산 여행',
      startDate: '2099-06-10',
      endDate: '2099-06-13',
      status: 'PLANNED',
      destinations: [{ seq: 1, region: '부산', nights: 3 }],
      ...cols,
    });
  }

  function renderHome() {
    const client = newTestQueryClient({ gcTime: 0 });
    return renderWithQueryClient(
      <WithToastHost>
        <HomePage />
      </WithToastHost>,
      client
    );
  }

  beforeEach(() => {
    mockPush.mockClear();
    itinReply = 404;
    itinGated = false;
    itinGates = [];
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
        if (itinGated) {
          await new Promise<void>((resolve) => itinGates.push(resolve));
        }
        if (itinReply === 404) {
          return HttpResponse.json(
            { error: { code: 'NOT_FOUND', message: '일정이 없어요' } },
            { status: 404 }
          );
        }
        if (itinReply === 500) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: '서버 오류' } },
            { status: 500 }
          );
        }
        return HttpResponse.json(itinReply);
      })
    );
  });

  // 단언이 문을 열기 전에 실패해도 붙잡힌 요청을 남기지 않는다(최상위 afterEach 의 server.resetHandlers 전에).
  afterEach(() => {
    const waiting = itinGates;
    itinGates = [];
    waiting.forEach((open) => open());
  });

  function openGates(): void {
    const waiting = itinGates;
    itinGates = [];
    act(() => {
      waiting.forEach((open) => open());
    });
  }

  /** 홈이 지배 여행의 CTA 를 그릴 때까지 기다린다(목록 도착). */
  async function ready(): Promise<void> {
    await screen.findByTestId(CTA);
    await settle();
  }

  describe('진입 — 목록 GET 1 · 일정 GET 0', () => {
    it.each<[string, Partial<Trip>]>([
      [
        '완전 AI 생성 중(PARTIAL · FULLY_AI)',
        itineraryCols({
          status: 'PLANNED',
          generationState: 'PARTIAL',
          generationMode: 'FULLY_AI',
          generationSessionId: 's',
        }),
      ],
      [
        '같이 짜기 생성 중(PARTIAL · CO_PLAN) — 누르기 전까지는 묻지 않는다',
        itineraryCols(copickRunning),
      ],
      [
        '확정',
        itineraryCols({
          status: 'CONFIRMED',
          generationState: 'COMPLETE',
          generationMode: 'FULLY_AI',
          generationSessionId: null,
        }),
      ],
      ['일정 없음', NO_ITINERARY],
    ])('%s', async (_label, cols) => {
      // 준비
      tripsBody = [planningTrip(cols)];

      // 실행
      renderHome();
      await ready();

      // 단언 — 앵커: CTA 가 그려졌다(= 목록이 도착해 지배 여행이 섰다). 요청은 목록 1번, 일정 0번.
      expect(screen.getByTestId(CTA)).toBeOnTheScreen();
      expect(listHits(hits)).toBe(1);
      expect(itineraryHits(hits)).toBe(0);
    });
  });

  describe('누름 — 목적지가 copick 이 아니면 조회 0, 즉시 이동', () => {
    it('완전 AI 생성 중 → 누르면 generating 으로 1회, 일정 GET 0 (목록 도착 직후에도 바로 활성)', async () => {
      tripsBody = [
        planningTrip(
          itineraryCols({
            status: 'PLANNED',
            generationState: 'PARTIAL',
            generationMode: 'FULLY_AI',
            generationSessionId: 's',
          })
        ),
      ];
      renderHome();
      await screen.findByTestId(CTA);
      // 앵커 — 아직 아무것도 안 눌렀다(이동 0).
      expect(mockPush).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId(CTA));

      expect(mockPush.mock.calls).toEqual([
        [`/trips/${TRIP_ID}/itinerary/generating`],
      ]);
      await settle();
      expect(itineraryHits(hits)).toBe(0);
    });

    it('일정 없음 → 누르면 method 로 1회, 일정 GET 0', async () => {
      tripsBody = [planningTrip(NO_ITINERARY)];
      renderHome();
      await screen.findByTestId(CTA);

      fireEvent.press(screen.getByTestId(CTA));

      expect(mockPush.mock.calls).toEqual([
        [`/trips/${TRIP_ID}/itinerary/method`],
      ]);
      await settle();
      expect(itineraryHits(hits)).toBe(0);
    });
  });

  describe('누름 — copick(같이 짜기 생성 중)이면 그때 일정을 한 번 묻는다', () => {
    beforeEach(() => {
      tripsBody = [planningTrip(itineraryCols(copickRunning))];
    });

    it('응답 전에는 이동하지 않고, 응답 뒤 첫 비고정 슬롯(copick/<슬롯>)으로 1회 간다 — 일정 GET 정확히 1', async () => {
      // 준비 — 일정 응답을 붙잡는다.
      itinReply = copickRunning;
      itinGated = true;
      renderHome();
      await ready();
      expect(itineraryHits(hits)).toBe(0);

      // 실행 ① — 누른다.
      fireEvent.press(screen.getByTestId(CTA));
      await settle();

      // 단언 ① — 요청은 나갔고(1) 응답 전이라 이동 0 (copick/complete 로 새지 않는다).
      expect(itineraryHits(hits)).toBe(1);
      expect(mockPush).not.toHaveBeenCalled();

      // 실행 ② — 응답이 도착한다.
      openGates();
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

      // 단언 ② — 첫 비고정 슬롯 주소(`#` 는 `%23` 으로 인코딩).
      expect(mockPush.mock.calls).toEqual([[FIRST_SLOT]]);
      expect(itineraryHits(hits)).toBe(1);
    });

    it('응답을 기다리는 동안 다시 눌러도(연타 · 창이 닫힌 뒤여도) 일정 GET 1 · 이동 1', async () => {
      itinReply = copickRunning;
      itinGated = true;
      renderHome();
      await ready();

      fireEvent.press(screen.getByTestId(CTA));
      // 연타 창(400ms)이 아니라 *호출부의 처리 중 잠금*이 막는 것을 가르려고 창을 일부러 닫고 다시 누른다.
      resetPressGuard();
      fireEvent.press(screen.getByTestId(CTA));
      fireEvent.press(screen.getByTestId('home-trip-hero'));
      await settle();
      expect(itineraryHits(hits)).toBe(1);

      openGates();
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

      expect(mockPush.mock.calls).toEqual([[FIRST_SLOT]]);
      expect(itineraryHits(hits)).toBe(1);
    });

    it.each<[string, Reply, string]>([
      [
        '그사이 같이 짜기가 완성(COMPLETE · CO_PLAN)됐다 → 재판정해 copick/complete',
        itineraryFixture({
          tripId: TRIP_ID,
          status: 'PLANNED',
          generationMode: 'CO_PLAN',
          generationState: 'COMPLETE',
          generationSessionId: null,
          days: COPICK_DAYS,
        }),
        `/trips/${TRIP_ID}/itinerary/copick/complete`,
      ],
      [
        '그사이 확정됐다 → 재판정해 live',
        itineraryFixture({
          tripId: TRIP_ID,
          status: 'CONFIRMED',
          generationMode: 'CO_PLAN',
          generationState: 'COMPLETE',
          generationSessionId: null,
          days: COPICK_DAYS,
        }),
        `/trips/${TRIP_ID}/live`,
      ],
      [
        '일정이 사라졌다(404) → method',
        404,
        `/trips/${TRIP_ID}/itinerary/method`,
      ],
    ])('%s', async (_label, reply, href) => {
      itinReply = reply;
      renderHome();
      await ready();

      fireEvent.press(screen.getByTestId(CTA));
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

      expect(mockPush.mock.calls).toEqual([[href]]);
      expect(itineraryHits(hits)).toBe(1);
    });

    it('일정 조회가 500 이면 이동하지 않고 실패 토스트를 띄우며(INV-4), 다시 누르면 다시 시도한다', async () => {
      // 준비
      itinReply = 500;
      renderHome();
      await ready();
      // 앵커 — 토스트가 아직 없다.
      expect(screen.queryByTestId(ITINERARY_OPEN_FAILED_TOAST_ID)).toBeNull();

      // 실행 ① — 실패하는 누름.
      fireEvent.press(screen.getByTestId(CTA));
      const toast = await screen.findByTestId(ITINERARY_OPEN_FAILED_TOAST_ID);

      // 단언 ① — 이동 0, 안내 있음, 요청 1.
      expect(toast).toBeOnTheScreen();
      expect(mockPush).not.toHaveBeenCalled();
      expect(itineraryHits(hits)).toBe(1);

      // 실행 ② — 서버가 회복했고 연타 창이 닫힌 뒤 다시 누른다(잠금이 풀려 있어야 한다).
      itinReply = copickRunning;
      resetPressGuard();
      fireEvent.press(screen.getByTestId(CTA));
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

      // 단언 ② — 이제 간다. 요청은 총 2.
      expect(mockPush.mock.calls).toEqual([[FIRST_SLOT]]);
      expect(itineraryHits(hits)).toBe(2);
    });
  });
});

// TRIP-1733 — onScroll 을 worklet 으로 옮겨도 홈 세로 스크롤이 FAB 묶음을 잠깐 숨기는 배선은 그대로다.
// 정확한 250ms 경계는 `useScrollHide.test.tsx` 몫이고 여기선 "숨었다 → 돌아왔다" 연결만 본다(실타이머 — MSW 와 가짜 시계를 섞지 않는다).
// 가로 레인을 끌 때 안 숨는지는 fireEvent.scroll 이 조상 onScroll 까지 불러 jest 로 못 가른다 — 6-b.
describe('스크롤 중 FAB 숨김 배선', () => {
  it('세로로 스크롤하면 FAB 묶음이 터치를 안 받고, 스크롤이 멈추면 다시 받는다', async () => {
    // 준비 — 받아 둔 (빈) 여행 목록으로 홈 본문까지 세운다. 로딩 중엔 FAB 묶음이 아예 없다.
    renderPage([]);
    await screen.findByTestId('home-hero-page-0');
    await settle();
    expect(screen.getByTestId('home-fab-layer')).toHaveProp(
      'pointerEvents',
      'box-none'
    );

    // 실행 — 세 필드를 다 싣는다(worklet 핸들러는 contentSize·layoutMeasurement 까지 읽는다).
    fireEvent.scroll(screen.getByTestId('home-dashboard-scroll'), {
      nativeEvent: {
        contentOffset: { x: 0, y: 200 },
        contentSize: { width: 390, height: 3000 },
        layoutMeasurement: { width: 390, height: 800 },
      },
    });
    // runOnJS 가 미룬 상태 변경(마이크로태스크)을 act 안에서 비운다.
    await act(async () => {});

    // 단언
    expect(screen.getByTestId('home-fab-layer')).toHaveProp(
      'pointerEvents',
      'none'
    );
    await waitFor(() =>
      expect(screen.getByTestId('home-fab-layer')).toHaveProp(
        'pointerEvents',
        'box-none'
      )
    );
  });
});

/**
 * TRIP-1754 · 담은 장소·저장 숙소 조회가 **실패했는데 "배지 없음·0곳"처럼 보이는** 문제(INV-4) — 실제 500 응답으로 잰다.
 *
 * 무엇을 보장하나(3동작 = 준비: 서버 응답 큐 → 실행: 홈 그리기·♥ 메뉴 펼치기 → 단언: 토스트·배지·하트):
 *  - **HM1** 장소 목록 500 → 토스트(문구·오류 아이콘) · 장소 배지 `–` · 숙소 배지는 제 숫자(독립) · 하트는 비활성 아님.
 *  - **HM2** 숙소 목록 500 → 토스트 · 숙소 배지 `–` · 장소 배지는 제 숫자.
 *  - **HM3** 둘 다 성공이면 토스트·`–` 없음.
 *  - **HM4** "화면당 1회" — 토스트를 비운 뒤 같은 실패가 또 와도(재조회 500) 다시 안 뜬다.
 *  - **HM5** 실패 캐시 위에 다시 마운트해 재조회가 **진행 중인 동안** 토스트는 없고(옛 실패로 쏘지 않는다), 재조회가 성공하면 끝까지 0,
 *    또 실패하면 그때 1회. 쿼리(장소·숙소)마다 한 행씩.
 *
 * *(개념)* 이 파일의 앱 전역 재시도는 0 이라 실패 응답 1개 = 확정 실패 1회다. 실제 앱은 ≈7초 뒤에야 확정 — jest 사각(6-b).
 */
describe('TRIP-1754 · 저장 목록 조회 실패 — 토스트 · 배지 `–`', () => {
  const TOAST = 'saved-list-load-error';
  const TOAST_TEXT = '저장 목록을 불러오지 못했어요';
  type Reply = 'ok' | 500 | 'hold' | 'hold500';

  function savedRow(poiId: string): SavedPlace {
    return {
      savedPlaceId: `sp-${poiId}`,
      savedAt: '2026-08-01T00:00:00Z',
      place: place(poiId, '서울', 10),
    };
  }
  const PLACE_ROWS: SavedPlace[] = [savedRow('서울-0'), savedRow('서울-1')];
  const STAY_ROWS: SavedStay[] = [
    {
      savedStayId: 'ss-1',
      name: '서울 호텔',
      coordConfirmed: true,
      linkedTripIds: [],
      registerRoute: 'MAP_SEARCH',
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    },
  ];

  let queues: Record<'saved-places' | 'saved-stays', Reply[]> = {
    'saved-places': [],
    'saved-stays': [],
  };
  let gate = createGate();

  async function answer(
    which: 'saved-places' | 'saved-stays',
    rows: unknown[]
  ): Promise<Response> {
    const reply = queues[which].shift() ?? 'ok';
    if (reply === 'hold' || reply === 'hold500') await gate.opened;
    if (reply === 500 || reply === 'hold500') {
      return HttpResponse.json(
        { error: { code: 'INTERNAL', message: '서버 오류' } },
        { status: 500 }
      );
    }
    return HttpResponse.json(rows);
  }

  beforeEach(() => {
    queues = { 'saved-places': [], 'saved-stays': [] };
    gate = createGate();
    // 파일 최상위 beforeEach 의 평소 `/saved-places` 위에 응답 큐 핸들러를 얹는다(server.use 는 앞에 끼운다).
    server.use(
      http.get(`${BASE}/saved-places`, () =>
        answer('saved-places', PLACE_ROWS)
      ),
      http.get(`${BASE}/saved-stays`, () => answer('saved-stays', STAY_ROWS))
    );
  });

  // 실패해 중간에 죽은 케이스가 보류 요청을 남기지 않게.
  afterEach(() => gate.release());

  function renderHome(client = newTestQueryClient({ gcTime: 0 })) {
    return {
      client,
      ...render(
        <WithToastHost>
          <HomePage />
        </WithToastHost>,
        { wrapper: createWrapper(client) }
      ),
    };
  }
  // 여행 목록이 오기 전엔 FAB 묶음이 아예 없다(로딩 얼굴) — 그려질 때까지 기다린 뒤 누른다.
  async function openSavedMenu(): Promise<void> {
    fireEvent.press(await screen.findByTestId('home-saved-menu-toggle'));
  }
  async function pause(ms = 100): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  it('HM1 장소 목록 500 → 토스트 · 장소 배지 `–` · 숙소 배지는 제 숫자(1) · 하트는 눌린다', async () => {
    // 준비
    queues['saved-places'] = [500];

    // 실행
    renderHome();
    const toast = await screen.findByTestId(TOAST);
    await openSavedMenu();

    // 단언
    expect(within(toast).getByText(TOAST_TEXT)).toBeOnTheScreen();
    expect(screen.getByTestId(`${TOAST}-error-icon`)).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByTestId('home-saved-stays-badge')).toHaveTextContent(
        '1'
      )
    );
    expect(screen.getByTestId('home-saved-places-badge')).toHaveTextContent(
      '–'
    );
    // 하트는 그대로(비활성 아님) — 누르면 서버가 409 로 담김에 수렴시킨다.
    const hearts = await screen.findAllByTestId(/^home-spot-save-/);
    expect(hearts.length).toBeGreaterThan(0);
    hearts.forEach((heart) => expect(heart).not.toBeDisabled());
  });

  it('HM2 숙소 목록 500 → 토스트 · 숙소 배지 `–` · 장소 배지는 제 숫자(2)', async () => {
    // 준비
    queues['saved-stays'] = [500];

    // 실행
    renderHome();
    const toast = await screen.findByTestId(TOAST);
    await openSavedMenu();

    // 단언
    expect(within(toast).getByText(TOAST_TEXT)).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByTestId('home-saved-places-badge')).toHaveTextContent(
        '2'
      )
    );
    expect(screen.getByTestId('home-saved-stays-badge')).toHaveTextContent('–');
  });

  it('HM3 둘 다 성공이면 토스트도 `–` 도 없고 배지는 제 숫자다', async () => {
    // 실행 — (앞 테스트의 토스트가 샌 거라면 아래 "토스트 없음"이 red 로 드러난다: 파일 최상위 afterEach 가 비운다.)
    renderHome();
    await openSavedMenu();
    await waitFor(() =>
      expect(screen.getByTestId('home-saved-places-badge')).toHaveTextContent(
        '2'
      )
    );
    await pause();

    // 단언
    expect(screen.getByTestId('home-saved-stays-badge')).toHaveTextContent('1');
    expect(screen.queryByText('–')).toBeNull();
    expect(screen.queryByTestId(TOAST)).toBeNull();
  });

  it('HM4 토스트를 비운 뒤 같은 실패가 또 와도(재조회 500) 다시 뜨지 않는다 — 화면당 1회', async () => {
    // 준비 — 두 번 다 500.
    queues['saved-places'] = [500, 500];
    const { client } = renderHome();
    await screen.findByTestId(TOAST);
    expect(count('GET /api/v1/saved-places')).toBe(1);

    // 실행 — 슬롯을 비우고(슬롯이 1개라 "보임 1개"로는 1회를 못 잰다) 같은 목록을 다시 받게 한다.
    resetToast();
    await act(async () => {
      await client.invalidateQueries({ queryKey: getGetSavedPlacesQueryKey() });
    });
    await waitFor(() => expect(count('GET /api/v1/saved-places')).toBe(2));
    await pause();

    // 단언 — 재조회가 정말 나갔고(앵커), 그런데도 토스트는 없다.
    expect(screen.queryByTestId(TOAST)).toBeNull();
  });

  describe.each(['saved-places', 'saved-stays'] as const)(
    'HM5 실패 캐시 위 재조회 진행 중 — %s',
    (which) => {
      async function mountOverFailedCache(second: Reply) {
        // 준비 — 첫 마운트에서 실패해 토스트가 뜨고, 닫는다(캐시 gcTime 무한). 두 번째 응답은 문 뒤.
        queues[which] = [500, second];
        const client = newTestQueryClient();
        const first = renderHome(client);
        await screen.findByTestId(TOAST);
        first.unmount();
        resetToast();
        // 실행 — 다시 마운트: 재조회가 시작되고 문 앞에서 멈춘다.
        renderHome(client);
        await waitFor(() => expect(count(`GET /api/v1/${which}`)).toBe(2));
        await pause();
      }

      it('보류 중엔 토스트가 없고, 재조회가 성공하면 끝까지 없다', async () => {
        await mountOverFailedCache('hold');
        // 단언 ① — 보류 중: 옛 실패만 보고 쏘지 않는다.
        expect(screen.queryByTestId(TOAST)).toBeNull();

        // 실행 ② — 문을 열면 200.
        gate.release();
        await pause();

        // 단언 ② — 앵커: 성공이 화면에 반영됐다(배지가 제 숫자) · 토스트는 끝까지 0.
        await openSavedMenu();
        await waitFor(() =>
          expect(
            screen.getByTestId(
              which === 'saved-places'
                ? 'home-saved-places-badge'
                : 'home-saved-stays-badge'
            )
          ).toHaveTextContent(which === 'saved-places' ? '2' : '1')
        );
        expect(screen.queryByText('–')).toBeNull();
        expect(screen.queryByTestId(TOAST)).toBeNull();
      });

      it('보류 중엔 토스트가 없고, 재조회도 실패로 굳으면 그때 1회 뜬다', async () => {
        await mountOverFailedCache('hold500');
        expect(screen.queryByTestId(TOAST)).toBeNull();

        gate.release();

        expect(
          within(await screen.findByTestId(TOAST)).getByText(TOAST_TEXT)
        ).toBeOnTheScreen();
      });
    }
  );
});

// TRIP-1740 AC-7(T13·T14) — 응답의 imageLicense(TYPE1)가 홈 두 레인(지금 뜨는 장소·요즘 담는 곳)의 카드 사진 칸까지 간다.
// 두 카드 VM 은 HomePage 가 Place 에서 골라 담는 곳(끊기는 곳)이라 여기서 한 번에 본다.
describe('홈 레인 · 관광공사 사진 유형이 카드 사진 칸에 닿는다', () => {
  const PHOTO = 'https://img.example/home-lane.jpg';

  it('TYPE1 서버 사진은 두 레인 모두 cover 이고 출처 글자가 붙는다', async () => {
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region') ?? '';
        return HttpResponse.json({
          items: (PLACES_BY_REGION[region] ?? []).map((item) => ({
            ...item,
            imageUrl: PHOTO,
            imageLicense: 'TYPE1',
          })),
          nextCursor: null,
        });
      })
    );

    renderPage();

    expect(await screen.findByTestId('home-spot-card-0')).toBeOnTheScreen();
    expectTypeOnePhotoDelivered('home-spot-photo-0', PHOTO);
    expectTypeOnePhotoDelivered('home-collection-photo-0', PHOTO);
  });
});
