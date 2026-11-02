import type { ReactElement } from 'react';
import {
  focusManager,
  QueryClientProvider,
  type QueryClient,
} from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';

import { createAppQueryClient } from '@/app/entrypoint/queryClient';
import { useBootstrapGate } from '@/features/auth';
import { server } from '@/mocks/server';
import { ExploreLandingPage } from '@/pages/explore/explore-landing';
import { HomePage } from '@/pages/home';
import { MyTripsListPage } from '@/pages/itinerary/itinerary-list';
import { RecordsCalendarPage } from '@/pages/record/records-calendar';
import { MyPage } from '@/pages/settings/my-page';
import { useGetPlacesPoiId } from '@/shared/api/index.hooks';
import type { Place, Trip } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { BASE } from '@/test-support/apiBase';
import { itinerary } from '@/test-support/itineraryFixtures';
import { createHitLog } from '@/test-support/mswHookHarness';
import { createClockSkew, settle } from '@/test-support/queryRender';

/**
 * TRIP-1714 · 포그라운드 복귀 팬아웃 정책 + 부팅→홈 요청 예산 (M-56 · M-61).
 *
 * 개념(처음 나오는 것만): **복귀** = 앱이 백그라운드에서 화면 앞으로 돌아오는 순간 — TanStack 의 `focusManager` 가 "포커스가 왔다"를
 * 알리면 캐시의 **낡은**(staleTime 이 지난) 쿼리를 다시 받는다(`refetchOnWindowFocus`). 탭 5개는 한 번 열면 계속 마운트돼 있어
 * 복귀 한 번에 탭마다 쿼리가 한꺼번에 나간다 = 팬아웃. 요청 수는 관찰자(화면) 수가 아니라 **낡은 키 수**에 비례한다.
 *
 * 무엇을 보장하나 (같은 대본으로 두 열을 돈다):
 *  - 후(`createAppQueryClient()` 가 만든 앱 기본값 그대로): 거부 목록 키(카탈로그·본인 편집이 직접 무효화하는 키)는 낡아도 복귀 때 0건,
 *    `/trips` 는 정확히 1건(관찰자가 여러 탭이어도), 전부 30초 안이면 0건.
 *  - 전(같은 클라이언트에 `setDefaultOptions` 로 `refetchOnWindowFocus: true` 를 덮어 1714 이전 동작을 재현): 같은 대본이 거부 목록 경로를
 *    실제로 부른다 — "0건" 단언이 하네스가 귀먹어서 나온 거짓 green 이 아님을 보이는 양성 짝이자 PR 의 전/후 표 값이다.
 *  - 범위 밖(목록에 없는 키)은 지금 동작 그대로 낡았으면 복귀 때 1건(AC6).
 *  - 부팅→홈(M-61): 저장 토큰으로 `useBootstrapGate`(실물) → HOME → 홈 첫 레인까지 나간 요청 수가 상한(실측값, 여유 없음) 이하.
 *
 * 어떻게: 실 `QueryClient`(앱 팩토리) + MSW + `Date.now` 만 감는 시계(`createClockSkew` — "키 나이"를 만든다). 복귀는
 * `focusManager.setFocused(false)` → 시계 진행 → `setFocused(true)` 로 흉내 낸다(AppState→focusManager 배선은 jest 가 못 봄 —
 * `AppProviders.queryWiring.test` 가 따로 잠그고, 실기는 6-b + 요청 카운터 배지).
 * 숫자는 이 하네스 **1회 실행** 실측이다(ms·바이트가 아니라 요청 수만 — 시뮬/실기 값과 다를 수 있다).
 *
 * 왜 `src/__tests__` 인가: 서로 다른 pages 슬라이스 5개를 한 트리에 올려야 하는데, pages 형제 import 는 층 린트가 막는다
 * (`nicknameMyPageSync.integration` 과 같은 이유).
 *
 * 3동작 뼈대: 준비(서버 대본·탭 5개 마운트·첫 요청이 다 끝나길 기다림) → 실행(백그라운드 → 시계 진행 → 복귀) → 단언(복귀 뒤 새로 나간 요청의 경로별 건수).
 * jest 사각: 실제 백그라운드 전환·iOS inactive 구간·실기 NetInfo — 6-b.
 */

jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('@/test-support/storageMock'),
}));

// 5개 탭이 쓰는 expo-router 멤버의 합집합 — 이동은 안 보고 렌더만 되게 한다. 일정 탭은 포커스 훅을 둘 쓰는데, 마운트 때 한 번만 부르고
// 탭 재진입(포커스 복귀)은 흉내 내지 않는다 — 이 하네스가 재는 것은 AppState 복귀 하나뿐이다.
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({
      push: jest.fn(),
      replace: jest.fn(),
      navigate: jest.fn(),
    }),
    useNavigation: () => ({ setOptions: jest.fn() }),
    usePathname: () => '/',
    useLocalSearchParams: () => ({}),
    router: { push: jest.fn() },
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
  };
});

const MIN = 60_000;
/** 부팅→홈 요청 수 상한 — 하네스 1회 실측값(AC9) — 여행 없음 7 = /bootstrap 1 + /trips 1 + /saved-places 1 + /saved-stays 1 + /places 3, 여행 중 6 = /places 1 + 지배 여행 일정 1. */
const BOOT_BUDGET = { noTrip: 7, inTrip: 5 };
const log = createHitLog(server);

const trip = (over: Partial<Trip> & Pick<Trip, 'tripId'>): Trip =>
  ({
    title: `여행 ${over.tripId}`,
    startDate: '2024-01-01',
    endDate: '2024-01-03',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'ENDED',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...over,
  }) as Trip;

/** 여행 N=3. 홈 얼굴만 갈린다: 여행 없음(전부 오래전에 끝남 → 탐색 얼굴) / 여행 중(오늘이 기간 안인 ACTIVE 하나가 지배 여행). */
const FACES = {
  noTrip: [
    trip({ tripId: 't1' }),
    trip({ tripId: 't2' }),
    trip({ tripId: 't3' }),
  ],
  inTrip: [
    trip({
      tripId: 't1',
      status: 'ACTIVE',
      startDate: '2020-01-01',
      endDate: '2099-12-31',
    }),
    trip({
      tripId: 't2',
      status: 'PLANNED',
      startDate: '2098-01-01',
      endDate: '2098-01-03',
    }),
    trip({ tripId: 't3' }),
  ],
} satisfies Record<string, Trip[]>;
type Face = keyof typeof FACES;

const place = (poiId: string, region: string): Place =>
  ({
    poiId,
    nameKo: `장소 ${poiId}`,
    category: '명소',
    lat: 35.1,
    lng: 129.0,
    region,
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 10,
    dataStatus: 'ACTIVE',
  }) as Place;

/** 경로별 건수 — 일정 id 는 `:id` 로 접는다(`GET /trips/:id/itinerary`). */
function byPath(hits: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const hit of hits) {
    const key = hit
      .replace('/api/v1', '')
      .replace(/\/trips\/[^/]+\/itinerary/, '/trips/:id/itinerary');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function serve(face: Face): void {
  server.use(
    http.get(`${BASE}/trips`, () => HttpResponse.json(FACES[face])),
    http.get(`${BASE}/trips/:tripId/itinerary`, ({ params }) =>
      HttpResponse.json(
        itinerary({ tripId: String(params.tripId), status: 'PLANNED' })
      )
    ),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json([])),
    http.get(`${BASE}/places`, ({ request }) => {
      const region = new URL(request.url).searchParams.get('region') ?? '';
      return HttpResponse.json({
        items: [0, 1, 2, 3, 4, 5, 6].map((i) =>
          place(`${region}-${i}`, region)
        ),
        nextCursor: null,
      });
    }),
    http.get(`${BASE}/stays/search`, () =>
      HttpResponse.json({ items: [], degraded: false, filterZeroReasons: [] })
    ),
    http.get(`${BASE}/me`, () =>
      HttpResponse.json({
        accountId: 'a1',
        status: 'ACTIVE',
        socialProviders: [],
      })
    ),
    http.get(`${BASE}/me/profile`, () =>
      HttpResponse.json({
        nickname: '여행자',
        nicknameUpdatedAt: '2026-01-01T00:00:00Z',
      })
    ),
    http.get(`${BASE}/me/style`, () =>
      HttpResponse.json({
        official: false,
        progress: { current: 0, required: 10 },
        analysis: null,
        preview: null,
      })
    ),
    http.get(`${BASE}/me/records`, () => HttpResponse.json({ items: [] }))
  );
}

let clock: ReturnType<typeof createClockSkew>;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  log.attach();
});
beforeEach(() => {
  log.reset();
  clock = createClockSkew();
  clearAccessToken();
  setAccessToken('valid-access');
});
// 포커스 매니저·시계는 모듈 싱글턴이다 — 파일 최상위에서 되돌려야 앞 케이스의 "백그라운드" 상태가 새지 않는다.
afterEach(() => {
  act(() => focusManager.setFocused(undefined));
  clock.restore();
  server.resetHandlers();
});
afterAll(() => server.close());

function FiveTabs(): ReactElement {
  return (
    <>
      <HomePage />
      <ExploreLandingPage />
      <MyTripsListPage />
      <RecordsCalendarPage />
      <MyPage />
    </>
  );
}

/** 앱 팩토리로 클라이언트를 만든다. `policy: false` 면 같은 클라이언트의 복귀 재조회만 1714 이전(전부 기본 true)으로 되돌린다. */
function newAppClient(policy: boolean): QueryClient {
  const client = createAppQueryClient();
  if (!policy) {
    client.setDefaultOptions({
      queries: {
        ...client.getDefaultOptions().queries,
        refetchOnWindowFocus: true,
      },
    });
  }
  return client;
}

/** 탭 5개를 올리고 첫 조회가 다 끝날 때까지 기다린 뒤, 복귀로 나간 요청만 세도록 기록을 비운다. */
async function mountFiveTabs(face: Face, client: QueryClient) {
  serve(face);
  const view = render(
    <QueryClientProvider client={client}>
      <FiveTabs />
    </QueryClientProvider>
  );
  await waitFor(() => expect(byPath(log.all())['GET /trips']).toBe(1));
  await settle();
  await settle();
  return view;
}

/** 백그라운드 → `ms` 경과 → 복귀 → 응답이 다 돌아올 때까지. 이 구간에 나간 요청의 경로별 건수. */
async function returnAfter(ms: number): Promise<Record<string, number>> {
  log.reset();
  act(() => focusManager.setFocused(false));
  clock.advance(ms);
  act(() => focusManager.setFocused(true));
  await settle();
  await settle();
  return byPath(log.all());
}

/** 한 번 돌린다: 탭 5개 마운트 → 복귀(`ms` 경과) → 복귀로 나간 요청 → 정리. `policy` false 면 1714 이전 동작. */
async function runReturn(
  face: Face,
  policy: boolean,
  ms: number
): Promise<Record<string, number>> {
  const client = newAppClient(policy);
  const view = await mountFiveTabs(face, client);
  const back = await returnAfter(ms);
  view.unmount();
  client.clear();
  return back;
}

// 후 열은 어느 얼굴·나이에서도 `/trips` 1 뿐이다 — TRIP-1677 부터 탭들은 일정 상태를 목록 칸에서 읽어 여행별 일정 GET 이 없다.
const REFRESHED = { 'GET /trips': 1 };
// 거부 목록 경로 — "전" 열에서는 30초만 지나도 1건씩 나간다(`/places` 는 레인 신선 시간이 10분이라 11분 뒤부터).
const DENIED_AT_5M = {
  'GET /saved-places': 1,
  'GET /saved-stays': 1,
  'GET /stays/search': 1,
  'GET /me': 1,
  'GET /me/profile': 1,
  'GET /me/style': 1,
  'GET /me/records': 1,
};

describe('TRIP-1714 · 탭 5개 복귀 팬아웃 — 전/후 요청 수 (AC1~AC4)', () => {
  // [이름, 홈 얼굴, 키 나이(ms), 전, 후]
  it.each([
    ['여행 없음 · 10초(전부 30초 안)', 'noTrip', 10_000, {}, {}],
    [
      '여행 없음 · 5분(30초 밖·레인 10분 안)',
      'noTrip',
      5 * MIN,
      { ...REFRESHED, ...DENIED_AT_5M },
      REFRESHED,
    ],
    [
      '여행 없음 · 11분(레인도 10분 밖)',
      'noTrip',
      11 * MIN,
      { ...REFRESHED, ...DENIED_AT_5M, 'GET /places': 3 },
      REFRESHED,
    ],
    ['여행 중 · 10초(전부 30초 안)', 'inTrip', 10_000, {}, {}],
    [
      '여행 중 · 5분(30초 밖·레인 10분 안)',
      'inTrip',
      5 * MIN,
      { ...REFRESHED, ...DENIED_AT_5M },
      REFRESHED,
    ],
    [
      '여행 중 · 11분(레인도 10분 밖)',
      'inTrip',
      11 * MIN,
      { ...REFRESHED, ...DENIED_AT_5M, 'GET /places': 4 },
      REFRESHED,
    ],
  ] as [
    string,
    Face,
    number,
    Record<string, number>,
    Record<string, number>,
  ][])('%s', async (_name, face, ms, before, after) => {
    // 준비·실행·단언을 두 열(전 → 후)에 같은 대본으로 한다 — 전이 거부 목록 경로를 실제로 부른다는 양성 짝이라
    // 후 열의 "그 경로는 0건"이 하네스가 귀먹어서 나온 결과가 아님을 보인다.
    expect(await runReturn(face, false, ms)).toEqual(before);
    expect(await runReturn(face, true, ms)).toEqual(after);
  });
});

describe('TRIP-1714 · 정책 범위 밖 키는 복귀 때 지금 그대로 (AC6)', () => {
  it('거부 목록에 없는 키(d06 단건 /places/{id})는 낡았으면 복귀 때 1건 받는다', async () => {
    // 준비 — 탭이 아니라 "탭 위에 쌓인 스택 화면"의 대역으로 단건 장소 하나만 읽는다.
    server.use(
      http.get(`${BASE}/places/:poiId`, ({ params }) =>
        HttpResponse.json(place(String(params.poiId), '부산'))
      )
    );
    const client = newAppClient(true);
    function Probe() {
      useGetPlacesPoiId('p1');
      return null;
    }
    const view = render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
    await waitFor(() => expect(log.all()).toEqual(['GET /api/v1/places/p1']));
    await settle();

    // 실행·단언 — 앵커(처음 1건) 뒤 5분 지난 복귀에서 1건 더.
    expect(await returnAfter(5 * MIN)).toEqual({ 'GET /places/p1': 1 });
    view.unmount();
    client.clear();
  });
});

/** 부팅 게이트(실물)가 HOME 으로 정하면 홈을 그린다 — `SplashGate` 의 얇은 대역(스플래시 하한·푸시 등록은 요청 수와 무관). */
function BootThenHome(): ReactElement | null {
  const { destination } = useBootstrapGate();
  return destination === 'HOME' ? <HomePage /> : null;
}

describe('TRIP-1714 · 부팅 → 홈 첫 레인까지 요청 예산 (AC9 · M-61)', () => {
  // 상한은 이 하네스 1회 실측값 그대로다(여유 없음) — 의도한 요청을 더하면 이 숫자를 올리고, 모르는 요청이 늘면 여기서 걸린다.
  it.each([
    ['여행 없음', 'noTrip', BOOT_BUDGET.noTrip],
    ['여행 중', 'inTrip', BOOT_BUDGET.inTrip],
  ] as const)(
    '저장 토큰으로 부팅하면 %s 홈이 첫 레인을 그릴 때까지 나간 요청이 예산 이하다',
    async (_name, face, budget) => {
      // 준비 — 저장 토큰(storageMock 의 old-access)이 있고 메모리 토큰은 비어 있다(부팅이 복원한다).
      clearAccessToken();
      serve(face);
      const client = newAppClient(true);

      // 실행
      const view = render(
        <QueryClientProvider client={client}>
          <BootThenHome />
        </QueryClientProvider>
      );
      expect(await screen.findByTestId('home-spot-card-0')).toBeOnTheScreen();
      await settle();

      // 단언 — 앵커(부트스트랩 1건·여행 목록 1건: 부팅 선취와 홈 조회가 한 요청으로 합쳐진다) + 총 예산.
      const counts = byPath(log.all());
      expect(counts['GET /bootstrap']).toBe(1);
      expect(counts['GET /trips']).toBe(1);
      expect(log.all().length).toBeLessThanOrEqual(budget);
      view.unmount();
      client.clear();
    }
  );
});
