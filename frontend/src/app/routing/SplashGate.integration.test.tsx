import { useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, Stack, Tabs } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';

import { useBootstrapGate, type BootstrapDestination } from '@/features/auth';
import {
  fakePushResponse,
  lastPushTapListener,
} from '@/test-support/pushOsFake';

import { SPLASH_MIN_VISIBLE_MS, SplashGate } from './SplashGate';

/**
 * 로그아웃·세션 만료로 게이트가 LOGIN 으로 바뀔 때 계정 경계 정리(`useAccountBoundaryReset`)가 **진짜 라우터에서**
 * 미처리 POP_TO_TOP 없이 로그인 하나만 남기는가(TRIP-1431 · QA Q-001, 정리 자체는 TRIP-1077).
 *
 * 왜 진짜 라우터인가: `SplashGate.accountBoundary.test` 는 router 를 목으로 바꿔 "무엇을 어떤 순서로 불렀나"만 본다.
 * 경고의 원인은 `router.canDismiss()` 가 가드 반영 **전** 스택 사본을 읽는 한 박자 차이라 목으로는 안 보인다.
 * expo-router 는 test 환경에서 미처리 액션을 console.error 대신 throw 한다 — 그래서 "던지지 않는다"가 "dev 경고 0건"이다.
 *
 * 루트 `_layout` 에 실물 SplashGate·실물 정리 훅을 꽂고(훅을 목으로 끄지 않는다), 게이트 목적지만 가짜 저장소로 바꾼다.
 * 설정 화면(runLogout) 없이 게이트만 뒤집으므로 세션 만료 경로이기도 하다.
 *
 * TRIP-1502 — 두 가지를 더 잠근다. ① 중첩 스택이 2장 이상 쌓인 다단(장소 탐색 위 위저드 step1·step2 등)에서도 이전 화면이
 * 루트에 안 남는다(`POP_TO_TOP` 은 포커스된 가장 안쪽 스택부터 받아서 위저드가 안에서 접고 끝나던 결함).
 * ② 홈이 아닌 탭 이력이 있을 때도 미처리 없이 로그인 하나가 된다 — 지금은 `(tabs)` 가 가드 안이라 안 터지지만,
 * 탭이 가드 밖으로 나오는 회귀를 이 행들이 잡는다.
 *
 * 상황 감지 FE-A — 푸시 탭 라우팅(`usePushRouting`)도 실물 그대로 꽂혀 있다. 훅 단위 테스트는 라우터 목이라
 * "스택이 그려진 뒤에 보낸 push 가 진짜 라우터에서 먹는가"를 못 봐서, 맨 아래 describe 가 여기서 본다.
 */

jest.mock('@/features/auth/model/useBootstrapGate', () => ({
  __esModule: true,
  BOOTSTRAP_TIMEOUT_MS: 3000,
  useBootstrapGate: jest.fn(),
}));
// 배럴은 실물을 먼저 펼친 뒤 덮는다 — 수신 입구(onPushTapped 등)는 실물이 전역 expo-notifications 목 위에서 돈다.
jest.mock('@/shared/push', () => ({
  ...jest.requireActual('@/shared/push'),
  registerPushIfGranted: jest.fn(),
}));

const mockUseBootstrapGate = useBootstrapGate as jest.MockedFunction<
  typeof useBootstrapGate
>;

// 게이트 목적지 저장소 — 값이 바뀌면 구독한 SplashGate 만 다시 그려진다(실제 로그아웃 때와 같은 모양).
let gateDestination: BootstrapDestination = 'HOME';
const gateListeners = new Set<() => void>();

function subscribeGate(listener: () => void): () => void {
  gateListeners.add(listener);
  return () => {
    gateListeners.delete(listener);
  };
}

function readGate(): BootstrapDestination {
  return gateDestination;
}

function flipGateTo(next: BootstrapDestination): void {
  gateDestination = next;
  gateListeners.forEach((listener) => listener());
}

function useFakeGate(): ReturnType<typeof useBootstrapGate> {
  const destination = useSyncExternalStore(subscribeGate, readGate, readGate);
  return { phase: 'resolved', destination, isProvisional: false };
}

let queryClient: QueryClient;

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SplashGate />
    </QueryClientProvider>
  );
}

function Empty() {
  return null;
}

function stub(testID: string) {
  return function Stub() {
    return <Text testID={testID}>{testID}</Text>;
  };
}

// SplashGate 가 선언하는 화면 7개 + 가드 밖 화면(settings·trips·explore/places — 위저드 진입점 중 하나). (onboarding) 은 index 를 두지 않는다 —
// '/' 가 (tabs)/index 와 겹치면 키 순서로 승부가 갈린다.
const ROUTES = {
  _layout: RootLayout,
  '(auth)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(auth)/login': stub('login-root'),
  '(onboarding)/_layout': () => (
    <Stack screenOptions={{ headerShown: false }} />
  ),
  '(onboarding)/welcome': Empty,
  'onboarding-tour': stub('tour-root'),
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/index': stub('home-root'),
  '(tabs)/my': Empty,
  'assistant/index': Empty,
  'explore/places': Empty,
  'force-update': Empty,
  reconsent: Empty,
  'settings/index': stub('settings-root'),
  'trips/[tripId]/live/index': Empty,
  'trips/[tripId]/planb/index': Empty,
  'trips/new/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  'trips/new/step1': Empty,
  'trips/new/step2': Empty,
};

type RouterApp = ReturnType<typeof renderRouter>;

/** 루트 스택에 남은 라우트 이름들(스와이프 뒤로가 되짚을 화면). 최상위는 expo-router 의 래퍼라 그 안을 읽는다. */
function rootStackNames(app: RouterApp): string[] {
  const stack = app.getRouterState()?.routes[0]?.state;
  return (stack?.routes ?? []).map((route) => route.name);
}

/** 위저드(`trips/new`) 안쪽 스택의 화면 이름들 — 루트에 위저드가 없으면 빈 배열. 위저드가 2장 이상일 때만 중첩 잔존이 난다. */
function wizardStepNames(app: RouterApp): string[] {
  const root = app.getRouterState()?.routes[0]?.state;
  const wizard = root?.routes.find((route) => route.name === 'trips/new');
  return (wizard?.state?.routes ?? []).map((route) => route.name);
}

/** `(tabs)` 안쪽 상태 — 현재 탭 이름과 탭 이력 길이. 탭에 한 번도 안 갔으면 이력이 없다(0). */
function tabsPosition(app: RouterApp): { current: string; history: number } {
  const root = app.getRouterState()?.routes[0]?.state;
  const tabs = root?.routes.find((route) => route.name === '(tabs)')?.state as
    | { index: number; routes: { name: string }[]; history?: unknown[] }
    | undefined;
  return {
    current: tabs?.routes[tabs.index]?.name ?? '',
    history: tabs?.history?.length ?? 0,
  };
}

/** 로그인 상태(HOME)로 앱을 열고 스플래시 하한을 넘긴 뒤 화면들을 차례로 쌓는다. */
function openSignedIn(pushes: string[]): RouterApp {
  const app = renderRouter(ROUTES, { initialUrl: '/' });
  act(() => {
    jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
  });
  for (const href of pushes) {
    // 테스트 라우트 표의 경로라 typedRoutes 가 모른다 — 타입만 눌러 둔다.
    act(() => router.push(href as never));
  }
  return app;
}

/** 정리가 끝난 뒤의 모습 — 로그인 하나만 남고 뒤로 갈 곳이 없다. */
function expectOnlyLogin(app: RouterApp): void {
  expect(rootStackNames(app)).toEqual(['(auth)']);
  expect(app.getPathname()).toBe('/login');
  expect(screen.getByTestId('login-root')).toBeOnTheScreen();
  expect(router.canGoBack()).toBe(false);
}

beforeEach(() => {
  jest.useFakeTimers();
  gateDestination = 'HOME';
  queryClient = new QueryClient();
  mockUseBootstrapGate.mockImplementation(useFakeGate);
});

afterEach(() => {
  queryClient.clear();
  mockUseBootstrapGate.mockReset();
  jest.useRealTimers();
});

// TRIP-1431 항목 1 — red: 가드 반영 전 사본으로 판정하면 걷을 화면이 없는 스택에 POP_TO_TOP 이 간다.
describe('로그아웃·세션 만료 정리는 진짜 라우터에서 미처리 POP_TO_TOP 을 내지 않는다', () => {
  it('설정 화면 위에서 게이트가 LOGIN 이 되면 경고(throw) 없이 로그인 하나만 남는다', () => {
    // 준비 — 홈 탭 위에 설정(가드 밖). 가드가 (tabs) 를 빼면 실제 스택엔 설정 하나만 남는다.
    const app = openSignedIn(['/settings']);
    expect(rootStackNames(app)).toEqual(['(tabs)', 'settings/index']);
    expect(screen.queryByTestId('login-root')).toBeNull();

    // 실행 + 단언 — 미처리 액션이 있으면 expo-router 가 여기서 던진다.
    expect(() =>
      act(() => {
        flipGateTo('LOGIN');
      })
    ).not.toThrow();

    // 단언
    expectOnlyLogin(app);
  });
});

// TRIP-1077 무회귀 — 걷기를 조건 없이 지우면 여행 화면이 로그인 아래 남아 red 다.
describe('정리는 걷어야 할 화면은 여전히 걷는다 (무회귀)', () => {
  it.each<[string, string[], string[]]>([
    [
      '가드 밖 여행 화면 둘이 쌓여 있으면 둘 다 걷힌다',
      ['/trips/1/live', '/trips/2/live'],
      ['(tabs)', 'trips/[tripId]/live/index', 'trips/[tripId]/live/index'],
    ],
    ['홈만 있으면(걷을 것 없음) 로그인으로 바뀐다', [], ['(tabs)']],
    // 걷기 지킴이 — 위저드 아래에 루트 화면이 있어야 걷기를 지운 뮤테이션이 red 다(위저드만 있으면 replace 혼자 로그인이 된다).
    [
      '위저드(중첩 스택 하나)가 가드 밖 여행 화면 위에 있으면 위저드째 걷힌다',
      ['/trips/1/live', '/trips/new/step1'],
      ['(tabs)', 'trips/[tripId]/live/index', 'trips/new'],
    ],
    // 걷기 지킴이는 아니다 — 수정 뒤 "걷을 루트 화면이 없는데 걷기를 보내 미처리가 나는" 회귀만 본다.
    [
      '위저드만 있으면(아래에 루트 화면이 없어 replace 하나로도 로그인 하나가 된다) 로그인으로 바뀐다',
      ['/trips/new/step1', '/trips/new/step2'],
      ['(tabs)', 'trips/new'],
    ],
    // 위저드 위에 루트 화면이 다시 올라오면 루트가 POP_TO_TOP 을 직접 받는다 — 위저드만 겨눈 수정이 이 모양을 깨는지 본다.
    [
      '위저드 위에 다시 루트 화면(설정)이 올라와 있어도 전부 걷힌다',
      ['/explore/places', '/trips/new/step1', '/trips/new/step2', '/settings'],
      ['(tabs)', 'explore/places', 'trips/new', 'settings/index'],
    ],
  ])('%s', (_name, pushes, stackBefore) => {
    // 준비 — 앵커: push 가 실제로 쌓였다(안 쌓이면 걷기 없이도 통과한다).
    const app = openSignedIn(pushes);
    expect(rootStackNames(app)).toEqual(stackBefore);

    // 실행
    expect(() =>
      act(() => {
        flipGateTo('LOGIN');
      })
    ).not.toThrow();

    // 단언
    expectOnlyLogin(app);
  });
});

// TRIP-1502 AC-1·2 — 홈이 아닌 탭 이력. `(tabs)` 가 가드 안인 지금은 선제 green 이라, 유효성은 뮤테이션으로 본다:
// `(tabs)` 를 가드 밖으로 옮기면 red(탭 이력 때문에 canGoBack 이 참인데 루트가 POP_TO_TOP 을 못 받는다) · 기존 `홈만` 행은 green.
describe('홈이 아닌 탭(마이)으로 옮겨 간 뒤에도 로그인 하나만 남는다 (탭 이력)', () => {
  it.each<[string, string[], string[]]>([
    ['마이 탭만', ['/my'], ['(tabs)']],
    [
      '마이 탭 이력 위에 설정 화면',
      ['/my', '/settings'],
      ['(tabs)', 'settings/index'],
    ],
    [
      '마이 탭 이력 위에 여행 화면',
      ['/my', '/trips/1/live'],
      ['(tabs)', 'trips/[tripId]/live/index'],
    ],
  ])('%s', (_name, pushes, stackBefore) => {
    // 준비 — 앵커: 루트 스택이 쌓였고, 탭은 홈이 아니라 마이에 있으며 이력이 2개다(canGoBack 이 탭 이력을 세는 조건).
    const app = openSignedIn(pushes);
    expect(rootStackNames(app)).toEqual(stackBefore);
    expect(tabsPosition(app)).toEqual({ current: 'my', history: 2 });

    // 실행
    expect(() =>
      act(() => {
        flipGateTo('LOGIN');
      })
    ).not.toThrow();

    // 단언
    expectOnlyLogin(app);
  });
});

// TRIP-1502 AC-5·6 — red: 위저드가 2장 이상이면 POP_TO_TOP 이 포커스된 안쪽(위저드)에서 접히고 끝나, 아래 루트 화면이 로그인 아래에 남았다.
// 세션 만료(401)는 step2(생성 대기) 중에 오기 쉬워서 위저드가 2장인 순간이 실제로 생긴다.
describe('위저드가 step2 까지 쌓인 채(세션 만료는 step2 대기 중에 온다) 로그아웃해도 이전 화면이 남지 않는다', () => {
  const STEP1 = '/trips/new/step1';
  const STEP2 = '/trips/new/step2';

  it.each<[string, string[], string[], string[]]>([
    [
      '장소 탐색에서 시작한 위저드',
      ['/explore/places', STEP1, STEP2],
      ['(tabs)', 'explore/places', 'trips/new'],
      ['step1', 'step2'],
    ],
    [
      'AI 도우미에서 시작한 위저드',
      ['/assistant', STEP1, STEP2],
      ['(tabs)', 'assistant/index', 'trips/new'],
      ['step1', 'step2'],
    ],
    [
      '여행 화면 위의 위저드',
      ['/trips/1/live', STEP1, STEP2],
      ['(tabs)', 'trips/[tripId]/live/index', 'trips/new'],
      ['step1', 'step2'],
    ],
    [
      '설정 위의 위저드',
      ['/settings', STEP1, STEP2],
      ['(tabs)', 'settings/index', 'trips/new'],
      ['step1', 'step2'],
    ],
    [
      '루트 화면 둘(여행 화면 → 장소 탐색) 아래의 위저드',
      ['/trips/1/live', '/explore/places', STEP1, STEP2],
      ['(tabs)', 'trips/[tripId]/live/index', 'explore/places', 'trips/new'],
      ['step1', 'step2'],
    ],
    [
      '위저드가 3장(step1 → step2 → step1)',
      ['/explore/places', STEP1, STEP2, STEP1],
      ['(tabs)', 'explore/places', 'trips/new'],
      ['step1', 'step2', 'step1'],
    ],
  ])('%s', (_name, pushes, stackBefore, wizardBefore) => {
    // 준비 — 앵커 둘: 루트에 쌓인 모양 + 위저드 안쪽이 2장 이상(1장이면 이 결함이 안 나 공허 green).
    const app = openSignedIn(pushes);
    expect(rootStackNames(app)).toEqual(stackBefore);
    expect(wizardStepNames(app)).toEqual(wizardBefore);

    // 실행
    expect(() =>
      act(() => {
        flipGateTo('LOGIN');
      })
    ).not.toThrow();

    // 단언 — 루트에 이전 화면(장소 탐색·설정·여행 화면…)이 없고 로그인 하나뿐이다.
    expectOnlyLogin(app);
  });
});

// 상황 감지 FE-A(frontend-components §2.2) — 탭 data 는 서버가 알림함 행의 {actionType, ...actionPayload} 를 펼친 모양.
const PLAN_B_TAP = {
  actionType: 'PLANB_REPLAN',
  tripId: 'trip-1',
  triggerId: 'trigger-1',
};

describe('푸시 탭은 진짜 라우터에서 알림함과 같은 곳으로 간다 (상황 감지 FE-A)', () => {
  it('그려진 HOME 에서 재계획 알림을 누르면 그 트리거의 재계획 진입이 열린다', () => {
    // 준비
    const app = openSignedIn([]);

    // 실행 — 사용자가 알림을 눌렀다.
    act(() => {
      lastPushTapListener(Notifications)(fakePushResponse('n1', PLAN_B_TAP));
    });

    // 단언 — 알림함 행과 같은 주소(`/trips/{tripId}/planb?triggerId=`). 라우터 파라미터에는 경로 조각 tripId 도 함께 실린다.
    expect(app.getPathname()).toBe('/trips/trip-1/planb');
    expect(app.getSearchParams()).toEqual({
      tripId: 'trip-1',
      triggerId: 'trigger-1',
    });
  });

  it('알림을 눌러 앱이 켜지면(콜드 스타트) 스플래시 동안은 기다렸다가 HOME 이 그려진 뒤 그 진입이 열린다', async () => {
    // 준비 — OS 가 앱을 켠 탭을 들고 있다.
    (
      Notifications.getLastNotificationResponseAsync as jest.Mock
    ).mockResolvedValueOnce(fakePushResponse('n-cold', PLAN_B_TAP));
    const app = renderRouter(ROUTES, { initialUrl: '/' });

    // 실행 1 — 꺼내기가 끝난다(아직 스플래시 하한 안)
    await act(async () => {});

    // 단언 1 — 스플래시 동안은 아직 그 화면이 아니다.
    // ⚠️ jest 의 진짜 라우터는 스택을 그리기 전에 보낸 push 도 받아 두었다가 그린 뒤 반영한다(뮤테이션 실측 — drawn 대신
    // true 를 넘겨도 이 it 은 green). "그린 뒤에만 보낸다"는 usePushRouting.test H1 이 잠그고, 실기 시점은 6-b(T-RD-3).
    expect(app.getPathname()).not.toBe('/trips/trip-1/planb');

    // 실행 2 — 하한이 지나 HOME 스택이 그려진다
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });

    // 단언 2
    expect(app.getPathname()).toBe('/trips/trip-1/planb');
    expect(app.getSearchParams()).toEqual({
      tripId: 'trip-1',
      triggerId: 'trigger-1',
    });
  });
});

// TRIP-1595 AC1·AC3 — 취향 2/2 완료 직후 기능 안내. 배선은 `replace` 두 번이라(진입·퇴장) 스택에 되돌아갈 화면이 남지 않아야
// 안드로이드 하드웨어 뒤로·iOS 가장자리 스와이프가 투어로 돌아오지 못한다. 목 라우터로는 이 스택 모양을 못 본다(브리프 4-1).
// 선제 green 가능: 라우트 파일만 있어도 expo-router 가 자동 등록하므로 SplashGate 에 선언이 없어도 이동은 된다 —
// 이 케이스가 지키는 것은 "선언을 ONBOARDING 가드 안에 두면 HOME 이 된 뒤 이동이 안 먹는다" 같은 잘못된 위치다.
describe('기능 안내는 진짜 라우터에서 한 장만 남는다 (TRIP-1595)', () => {
  it('온보딩 → 게이트 HOME → replace(/onboarding-tour) 뒤 투어 하나만 남고, replace(/) 뒤엔 홈 하나만 남는다', () => {
    // 준비 — 온보딩 중. 앵커: 온보딩 그룹만 그려져 있다.
    gateDestination = 'ONBOARDING';
    const app = renderRouter(ROUTES, { initialUrl: '/welcome' });
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });
    expect(rootStackNames(app)).toEqual(['(onboarding)']);

    // 실행 1 — 완료 응답 뒤 게이트가 HOME 을 열고, 그 다음에 투어로 보낸다(PrefStep2Page 의 순서).
    act(() => {
      flipGateTo('HOME');
    });
    act(() => router.replace('/onboarding-tour' as never));

    // 단언 1 — 투어 하나뿐이고 뒤로 갈 곳이 없다.
    expect(rootStackNames(app)).toEqual(['onboarding-tour']);
    expect(app.getPathname()).toBe('/onboarding-tour');
    expect(screen.getByTestId('tour-root')).toBeOnTheScreen();
    expect(router.canGoBack()).toBe(false);

    // 실행 2 — 건너뛰기·시작하기.
    act(() => router.replace('/'));

    // 단언 2 — 홈 하나뿐, 투어는 스택에 없다.
    expect(rootStackNames(app)).toEqual(['(tabs)']);
    expect(screen.getByTestId('home-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('tour-root')).toBeNull();
    expect(router.canGoBack()).toBe(false);
  });
});
