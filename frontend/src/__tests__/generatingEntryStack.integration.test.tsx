import { useState, type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, Tabs, useLocalSearchParams } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from 'expo-router/testing-library';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import MustVisitListRoute from '@routes/trips/[tripId]/itinerary/must-visits/index';

/**
 * TRIP-1263 (QA F5) · 생성 화면 아래 스택이 `(tabs)` 뿐이라, 뒤로(스와이프·하드웨어)가 앱바 ‹ 와 같은 곳에 닿는다.
 *
 * 왜 실물 라우터인가: 버그는 "어떤 함수를 불렀나"가 아니라 "그 결과 스택이 어떤 모양인가"에 있다. 라우터 목은
 * 호출 순서까지만 보고(`MustVisitListPage.integration`·`TripBasesPage.integration`), `dismissTo` 다음 `push` 를
 * 한 번에 부르면 실제로 `[(tabs), generating]` 이 되는지는 라우터만 안다. 라우터 목 파일엔 `jest.mock('expo-router')`
 * 가 파일 전체에 걸려 있어 여기 둘 수 없다 — 그래서 라우트 묶음 테스트로 따로 둔다(`notFoundRoute.integration` 선례).
 *
 * *(개념)* `renderRouter` — expo-router 가 주는 테스트용 앱. 경로 → 화면 표를 넘기면 실제 라우터가 돈다.
 *   그 결과의 `getRouterState()` 는 라우터의 스택을 그대로 돌려준다. `router.back()` 은 iOS 스와이프·Android
 *   하드웨어 뒤로가 결국 보내는 것과 같은 "맨 위 한 장 빼기"다(제스처 자체는 실기 전용 — 6-b).
 *
 * 무엇이 실물이고 무엇이 대역인가:
 *  - 실물: 필수 방문지 라우트(`MustVisitListRoute` → `MustVisitListPage`, 가짜 서버 위). 고치는 대상이 이것이다.
 *  - 대역: 생성 화면·초안·홈 탭들. 실물 생성 화면은 마운트 즉시 생성 POST 를 쏘므로 params 를 글자로 보이는
 *    가짜로 둔다. 대역의 ‹ 는 실물 `GeneratingPage` ‹ 와 같은 `router.dismissTo('/(tabs)')` 한 줄이다.
 *  - 루트는 `SplashGate` 대신 맨 `<Stack />` — 앱에서도 `(tabs)` 와 `trips/...` 가 루트 Stack 한 줄의 형제라
 *    스택 모양은 같다. 부팅 가드는 이 칸의 관심사가 아니다.
 *
 * 3동작: 준비 = 일정 탭 → 방식 선택 → 필수 방문지까지 쌓은 앱 → 실행 = CTA → (뒤로) → 단언 = 루트 스택·도착 경로.
 *
 * 통합 버킷 이유: 실물 expo-router 는 node 버킷(`--experimental-vm-modules`)에서 로드가 실패한다.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(MustVisitListPage 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-t';
const GENERATING = 'trips/[tripId]/itinerary/generating';
const MUST_VISITS = 'trips/[tripId]/itinerary/must-visits/index';
const PROCEED = 'itinerary-mustvisit-screen-proceed';

function stub(testID: string) {
  return function Stub() {
    return <Text testID={testID}>{testID}</Text>;
  };
}

/** 생성 화면 대역 — 받은 params 를 글자로 보이고, ‹ 는 실물 `GeneratingPage` ‹ 와 같은 한 줄이다. */
function GeneratingProbe() {
  const params = useLocalSearchParams();
  return (
    <>
      <Text testID="generating-probe">{JSON.stringify(params)}</Text>
      <Pressable
        testID="generating-probe-chevron"
        onPress={() => router.dismissTo('/(tabs)')}
      />
    </>
  );
}

/** 앱 루트 — 쿼리 캐시를 한 번만 만들어 스택 전체가 공유한다(실물 페이지가 조회 훅을 쓴다). */
function RootLayout(): ReactNode {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0 },
          mutations: { gcTime: 0 },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <Stack />
    </QueryClientProvider>
  );
}

const ROUTES = {
  _layout: RootLayout,
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/index': stub('home-root'),
  '(tabs)/itinerary': stub('itinerary-tab-root'),
  'trips/[tripId]/itinerary/method': stub('method-root'),
  [MUST_VISITS]: MustVisitListRoute,
  [GENERATING]: GeneratingProbe,
  'trips/[tripId]/itinerary/draft': stub('draft-root'),
  'trips/[tripId]/itinerary/copick/[slotKey]': stub('copick-slot-root'),
};

type StackRoute = {
  name: string;
  params?: Record<string, unknown>;
  state?: { index?: number };
};

/** 지금 그려진 테스트 앱 — 경로·스택 조회는 `screen` 이 아니라 `renderRouter` 결과가 준다. */
let app: ReturnType<typeof renderRouter>;

/** 루트 Stack 의 화면 이름들(아래→위). `getRouterState()` 맨 위는 expo-router 의 `__root` 포장이라 한 겹 내려간다. */
function rootStack(): StackRoute[] {
  const state = app.getRouterState() as
    { routes: { state?: { routes: StackRoute[] } }[] } | undefined;
  return state?.routes[0]?.state?.routes ?? [];
}

function rootNames(): string[] {
  return rootStack().map((route) => route.name);
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  resetPressGuard();
  setAccessToken('valid-access');
  // 0곳 얼굴 — CTA 가 곧바로 보이는 가장 짧은 길(다음 CTA 는 0곳·목록 얼굴이 같은 `goToGenerating` 이다).
  server.use(
    http.get(`${BASE}/trips/:tripId/must-visits`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json([]))
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/**
 * 준비 — 일정 탭에서 위저드 3/4(방식 선택)을 거쳐 필수 방문지까지 쌓는다(브리프 내비게이션 맵 첫 줄).
 * 일정 탭에서 시작하는 이유: 홈이 아닌 탭에서 떠나야 "도착 탭"이 ‹ 와 같은지까지 갈린다.
 */
async function openMustVisits(mode?: 'CO_PLAN'): Promise<void> {
  app = renderRouter(ROUTES, { initialUrl: '/itinerary' });
  act(() => {
    router.push({
      pathname: '/trips/[tripId]/itinerary/method',
      params: { tripId: TRIP_ID },
    } as never);
  });
  act(() => {
    router.push({
      pathname: '/trips/[tripId]/itinerary/must-visits',
      params: mode ? { tripId: TRIP_ID, mode } : { tripId: TRIP_ID },
    } as never);
  });
  // 0곳 얼굴이 뜰 때까지 — 로딩 중 CTA 는 잠겨 있어 누르면 아무 일도 안 일어난다(02a ★).
  await screen.findByTestId('itinerary-mustvisit-screen-empty');
  // 앵커 — 생성 전 스택은 정말로 방식 선택·필수 방문지를 품고 있다(아래 단언이 공짜로 통과하지 않게).
  expect(rootNames()).toEqual([
    '(tabs)',
    'trips/[tripId]/itinerary/method',
    MUST_VISITS,
  ]);
}

/** ‹ 가 닿는 곳 — RT-0 이 실측한 값. 루트엔 `(tabs)` 한 장, 경로는 홈 탭('/'). */
const HOME_LANDING = { rootNames: ['(tabs)'], pathname: '/' };

function landing(): { rootNames: string[]; pathname: string } {
  return { rootNames: rootNames(), pathname: app.getPathname() };
}

describe('RT-0 · 기준점 — 생성 화면 ‹ 는 홈 탭 묶음 한 장으로 걷는다 (선제 green)', () => {
  it('필수 방문지에서 올라온 생성 화면의 ‹ 는 루트를 (tabs) 한 장으로, 경로를 홈 탭으로 만든다', async () => {
    // 이 테스트가 RT-1·RT-2 의 기대값(HOME_LANDING)을 실측으로 고정한다. 떠날 때 일정 탭이었어도 ‹ 는
    // 홈 탭으로 푼다(`dismissTo('/(tabs)')` 가 탭 묶음을 첫 탭으로 되돌린다 — 02a §5 실측).
    // 준비
    await openMustVisits();
    fireEvent.press(screen.getByTestId(PROCEED));
    await screen.findByTestId('generating-probe');

    // 실행
    fireEvent.press(screen.getByTestId('generating-probe-chevron'));

    // 단언
    expect(landing()).toEqual(HOME_LANDING);
    expect(screen.getByTestId('home-root')).toBeOnTheScreen();
  });
});

describe('🔴 RT-1 · TRIP-1263 AC-1·AC-2 — CTA 로 연 생성 화면 아래는 (tabs) 뿐이고, 뒤로는 ‹ 와 같은 곳이다', () => {
  it.each([
    ['완전 AI', undefined, { tripId: TRIP_ID, mode: 'FULLY_AI' }],
    [
      '같이 짜기',
      'CO_PLAN',
      {
        tripId: TRIP_ID,
        mode: 'CO_PLAN',
        successRoute: '/trips/[tripId]/itinerary/copick/[slotKey]',
      },
    ],
  ] as const)('%s', async (_label, mode, expectedParams) => {
    // 준비
    await openMustVisits(mode);

    // 실행 ① — 다음 CTA.
    fireEvent.press(screen.getByTestId(PROCEED));
    await screen.findByTestId('generating-probe');

    // 단언 ① — 생성 화면 바로 아래가 (tabs) 다. 방식 선택·필수 방문지가 남아 있으면 red(옛 push 단독).
    expect(rootNames()).toEqual(['(tabs)', GENERATING]);
    // 생성 화면이 받은 params 는 예전 그대로다(걷기가 신호를 잃지 않는다).
    expect(rootStack()[1]?.params).toEqual(expectedParams);

    // 실행 ② — 스와이프·하드웨어 뒤로와 같은 "한 장 빼기".
    act(() => {
      router.back();
    });

    // 단언 ② — ‹ 와 같은 곳(RT-0). 필수 방문지로 돌아가 CTA 를 다시 누를 길이 없고, 더 뒤로 갈 곳도 없다.
    expect(landing()).toEqual(HOME_LANDING);
    expect(screen.queryByTestId(PROCEED)).toBeNull();
    expect(router.canGoBack()).toBe(false);
  });
});

describe('🔴 RT-2 · TRIP-1263 AC-2·AC-3 — 생성 성공 착지와 다시 짜기도 (tabs) 바로 위에 선다', () => {
  /**
   * 생성 화면의 성공 착지(replace)와 초안의 "다시 짜기"(replace)는 이 칸에서 **바꾸지 않는다** — 그래서
   * 대역이 실물과 같은 replace 한 줄을 대신 부른다(`GeneratingPage` 성공 착지 · `DraftPage` goGenerating).
   * 이 테스트가 재는 것은 "진입에서 걷어 두면 그 뒤 replace 들도 깨끗한 바닥 위에서 일어난다"이다.
   */
  it.each([
    [
      '완전 AI → 초안',
      undefined,
      {
        pathname: '/trips/[tripId]/itinerary/draft',
        params: { tripId: TRIP_ID },
      },
      'trips/[tripId]/itinerary/draft',
    ],
    [
      '같이 짜기 → 첫 슬롯',
      'CO_PLAN',
      {
        pathname: '/trips/[tripId]/itinerary/copick/[slotKey]',
        params: { tripId: TRIP_ID, slotKey: 'slot-1' },
      },
      'trips/[tripId]/itinerary/copick/[slotKey]',
    ],
  ] as const)('%s', async (_label, mode, successHref, successName) => {
    // 준비 — CTA 로 생성 화면까지.
    await openMustVisits(mode);
    fireEvent.press(screen.getByTestId(PROCEED));
    await screen.findByTestId('generating-probe');

    // 실행 — 생성 성공 착지(대역: 실물과 같은 replace).
    act(() => {
      router.replace(successHref as never);
    });

    // 단언 — 착지 화면 아래에 필수 방문지·방식 선택이 없고, 거기서 뒤로도 ‹ 와 같은 곳이다.
    expect(rootNames()).toEqual(['(tabs)', successName]);
    act(() => {
      router.back();
    });
    expect(landing()).toEqual(HOME_LANDING);
  });

  it('초안의 "다시 짜기"(확인창 없이 replace 1회)로 다시 연 생성 화면도 (tabs) 바로 위다', async () => {
    // 준비 — 완전 AI 로 생성 → 초안 착지.
    await openMustVisits();
    fireEvent.press(screen.getByTestId(PROCEED));
    await screen.findByTestId('generating-probe');
    act(() => {
      router.replace({
        pathname: '/trips/[tripId]/itinerary/draft',
        params: { tripId: TRIP_ID },
      } as never);
    });

    // 실행 — "다시 짜기"(대역: DraftPage goGenerating 과 같은 replace 한 줄 — DraftPage 무변경).
    act(() => {
      router.replace({
        pathname: '/trips/[tripId]/itinerary/generating',
        params: { tripId: TRIP_ID, mode: 'FULLY_AI' },
      } as never);
    });

    // 단언 — 옛 초안도 필수 방문지도 아래에 없고, 뒤로는 ‹ 와 같은 곳이다(F5 "옛 추천안이 아래" 통로).
    expect(rootNames()).toEqual(['(tabs)', GENERATING]);
    act(() => {
      router.back();
    });
    expect(landing()).toEqual(HOME_LANDING);
  });
});
