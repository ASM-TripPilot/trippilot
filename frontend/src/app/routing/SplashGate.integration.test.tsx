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
 * 범위 밖: 가드 밖 화면 위에 중첩 스택이 또 쌓인 다단(예: 여행 화면 위 위저드)은 지금도 루트에 이전 화면이 남는다 —
 * 별도 티켓 후보라 여기서 잠그지 않는다.
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

// SplashGate 가 선언하는 화면 7개 + 가드 밖 화면(settings·trips). (onboarding) 은 index 를 두지 않는다 —
// '/' 가 (tabs)/index 와 겹치면 키 순서로 승부가 갈린다.
const ROUTES = {
  _layout: RootLayout,
  '(auth)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(auth)/login': stub('login-root'),
  '(onboarding)/_layout': () => (
    <Stack screenOptions={{ headerShown: false }} />
  ),
  '(onboarding)/welcome': Empty,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/index': stub('home-root'),
  '(tabs)/my': Empty,
  'assistant/index': Empty,
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
    [
      '위저드(중첩 스택 하나)가 쌓여 있으면 위저드째 걷힌다',
      ['/trips/new/step1', '/trips/new/step2'],
      ['(tabs)', 'trips/new'],
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
