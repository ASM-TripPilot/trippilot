import { useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, Stack, Tabs } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from 'expo-router/testing-library';

import { useBootstrapGate, type BootstrapDestination } from '@/features/auth';
import {
  documentFileCount,
  failFileReads,
  failFileWrites,
  resetFakeFs,
} from '@/test-support/fakeExpoFileSystem';
import {
  fakePushResponse,
  lastPushTapListener,
  primeOsPermission,
  type OsPermission,
} from '@/test-support/pushOsFake';

import {
  PERMISSION_LOOKUP_WAIT_MAX_MS,
  usePermissionCatchUp,
} from '@/app/model/usePermissionCatchUp';
import { OnboardingTourPage } from '@/pages/onboarding/onboarding-tour';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { promptAndRegisterPush } from '@/shared/push';

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
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
}));

// 생성 완료 감지(TRIP-1618)는 useGenerationWatch.integration.test 가 본다 — 이 파일의 라우터·캐시 흐름과 섞이지 않게 끈다.
jest.mock('@/app/model/useGenerationWatch', () => ({
  useGenerationWatch: jest.fn(),
}));

// TRIP-1601 — 권한 안내. 훅은 실물을 감싼 스파이다: 아래 맨 앞 beforeEach 가 기본으로 "붙잡지 않는다"로 끄고(기존 describe 들은 동기
// advanceTimers 흐름이라 비동기 조회가 스플래시를 붙잡으면 안 맞는다), 권한 안내 describe 만 실물로 되돌린다.
jest.mock('@/app/model/usePermissionCatchUp', () => {
  const actual = jest.requireActual('@/app/model/usePermissionCatchUp');
  return {
    ...actual,
    usePermissionCatchUp: jest.fn(actual.usePermissionCatchUp),
  };
});
// OS 위치 권한 — 실물을 펼친 뒤 이 셋만 덮는다(펼치지 않으면 모듈 최상위에서 상수(Accuracy 등)를 읽는 형제 import 가 죽는다).
const mockGetForeground = jest.fn();
const mockRequestForeground = jest.fn();
const mockGetBackground = jest.fn();
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForeground(...args),
  getBackgroundPermissionsAsync: (...args: unknown[]) =>
    mockGetBackground(...args),
}));
// "봤음" 기록은 앱 샌드박스 파일(문서 폴더)이다 — iOS 키체인(SecureStore)은 앱을 지워도 남아 "재설치면 다시"가 성립하지 않는다(TRIP-1601 결정).
// 파일 시스템은 메모리 대역(`fakeExpoFileSystem`, 문서 폴더 포함). SecureStore 는 일부러 **쓰기를 세는** 대역으로 남겨 두어,
// 구현이 키체인에 기록하면 `mockVault` 가 차서 red 가 된다.
jest.mock(
  'expo-file-system',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/test-support/fakeExpoFileSystem').fakeExpoFileSystemModule
);
const mockVault = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockVault.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockVault.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockVault.delete(key);
  },
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

// SplashGate 가 선언하는 화면 7개 + 가드 밖 화면(settings·trips·explore/places — 위저드 진입점 중 하나).
// 실제 app/ 처럼 '/' 로 풀리는 화면이 둘이다((onboarding)/index · (tabs)/index) — TRIP-1628. 이 줄을 빼면 HOME 중 `replace('/')` 가
// 홈에 도착하는 거짓 green 이 생겨(TRIP-1597) 'TRIP-1628' describe 의 카나리가 red 가 된다.
const ROUTES = {
  _layout: RootLayout,
  '(auth)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(auth)/login': stub('login-root'),
  '(onboarding)/_layout': () => (
    <Stack screenOptions={{ headerShown: false }} />
  ),
  '(onboarding)/index': stub('onboarding-index'),
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

const mockCatchUp = usePermissionCatchUp as jest.Mock;
const realCatchUp = jest.requireActual('@/app/model/usePermissionCatchUp')
  .usePermissionCatchUp as typeof usePermissionCatchUp;
const mockPrompt = promptAndRegisterPush as jest.Mock;

type LocationStatus = 'undetermined' | 'granted' | 'denied';

function locationResponse(status: LocationStatus) {
  return {
    status,
    granted: status === 'granted',
    canAskAgain: status === 'undetermined',
    expires: 'never',
  };
}

/** OS 위치 권한 가짜 — 조회는 지금 상태, 요청은 미결정일 때만 `answer` 로 굳는다(실제 OS 와 같다). */
function primeLocation(
  initial: LocationStatus,
  answer: LocationStatus = 'denied'
): void {
  let current = initial;
  mockGetForeground.mockImplementation(async () => locationResponse(current));
  mockRequestForeground.mockImplementation(async () => {
    if (current === 'undetermined') current = answer;
    return locationResponse(current);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  gateDestination = 'HOME';
  queryClient = new QueryClient();
  mockUseBootstrapGate.mockImplementation(useFakeGate);
  // 파일 최상위 — 모듈 싱글턴(권한 가짜·저장소·훅 스파이)이 describe 사이로 새지 않게 매 테스트 기본값으로 되돌린다.
  // 기본 = "아무 일 없음": 위치·알림 모두 이미 결정됨, 저장소 비어 있음, 권한 안내 훅은 끔.
  mockCatchUp.mockImplementation(() => false);
  mockGetForeground.mockReset();
  mockRequestForeground.mockReset();
  primeLocation('granted');
  mockGetBackground.mockReset();
  mockGetBackground.mockResolvedValue(locationResponse('granted'));
  primeOsPermission(Notifications, 'denied');
  mockVault.clear();
  resetFakeFs();
  mockPrompt.mockClear();
  (Notifications.getPermissionsAsync as jest.Mock).mockClear();
  (Notifications.requestPermissionsAsync as jest.Mock).mockClear();
});

afterEach(() => {
  queryClient.clear();
  mockUseBootstrapGate.mockReset();
  resetFakeFs();
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
describe('기능 안내는 진짜 라우터에서 한 장만 남는다 (TRIP-1595 · TRIP-1597)', () => {
  // TRIP-1597 — 실제 app/ 에는 '/' 로 풀리는 화면이 둘이다((onboarding)/index · (tabs)/index). 옛 ROUTES 는 그 겹침을 빼 두어
  // 투어의 '/' 이동이 배포 빌드에서 조용히 무시되는 것을 못 봤다(TRIP-1628 부터 공유 ROUTES 가 둘 다 둔다).
  // 이 케이스는 투어 자리에 진짜 페이지를 꽂아 건너뛰기를 누른다(라우터를 직접 부르면 페이지가 쓰는 목적지를 안 본다).
  const REAL_ROUTES = {
    ...ROUTES,
    'onboarding-tour': OnboardingTourPage,
  };

  it('온보딩 → 게이트 HOME → 투어 하나만 남고, 건너뛰기를 누르면 (onboarding)/index 가 있어도 홈 하나만 남는다', () => {
    // 준비 — 온보딩 중. 앵커: 온보딩 그룹만 그려져 있다.
    gateDestination = 'ONBOARDING';
    const app = renderRouter(REAL_ROUTES, { initialUrl: '/welcome' });
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
    expect(screen.getByTestId('onboarding-tour-skip')).toBeOnTheScreen();
    expect(router.canGoBack()).toBe(false);

    // 실행 2 — 건너뛰기(시작하기와 같은 콜백). 진입 때 열린 연타 창은 닫고 누른다.
    resetPressGuard();
    act(() => {
      fireEvent.press(screen.getByTestId('onboarding-tour-skip'));
    });

    // 단언 2 — 홈 하나뿐, 투어·온보딩 index 는 없다.
    expect(rootStackNames(app)).toEqual(['(tabs)']);
    expect(screen.getByTestId('home-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-index')).toBeNull();
    expect(router.canGoBack()).toBe(false);
  });
});

/**
 * TRIP-1628 — 루트 `'/'` 는 가드가 정한다 (M-38 ROUTES 누락 카나리 + M-26 재동의 `replace('/')` 도착).
 *
 * 배경: 실제 app/ 에는 `'/'` 로 풀리는 화면이 둘이다((onboarding)/index · (tabs)/index). 라우터는 이름순으로 하나를 고르고((onboarding) < (tabs)),
 * 그 화면이 현재 목적지의 가드 안이 아니면 이동은 **throw 도 경고도 없이 사라진다**(조용한 무시). 그래서 "던지지 않는다"만 단언하면 빈 통과고,
 * 반드시 pathname·스택·화면 testID 로 본다. `ReconsentPage` 의 `router.replace('/')` 도착은 `ReconsentPage.test` 가 목 라우터라 못 보므로 여기서 본다.
 *
 * 무엇을 보장하나:
 *  - 카나리(M-38): HOME 에서 설정 화면 위 `replace('/')` 는 무시된다 — 공유 ROUTES 에서 `(onboarding)/index` 를 빼면 홈으로 도착해 red.
 *  - 재동의(M-26): RECONSENT 중 `replace('/')` 는 **아무 일도 안 한다**(화면은 `/reconsent` 그대로). 게이트가 HOME/ONBOARDING/LOGIN 으로 뒤집히는
 *    순간에야 가드 전환이 화면을 각각 홈·온보딩 index·로그인으로 옮긴다. 즉 `replace('/')` 는 장식이고 도착은 전환이 만든다.
 * 못 보는 것: 서버 왕복으로 게이트가 실제 뒤집히는 부분(가짜 게이트로 대신 — `useBootstrapGate.test` 몫)·네이티브 전환 애니메이션.
 */
describe("루트 '/' 해석은 진짜 라우터에서 가드를 따른다 (TRIP-1628)", () => {
  it("카나리: HOME 에서 설정 화면 위 replace('/') 는 이동 없이 무시된다 — 던지지도 홈으로 가지도 않는다", () => {
    // 준비 — 홈 탭 위에 설정. 앵커: 지금 설정이 보인다.
    const app = openSignedIn(['/settings']);
    expect(rootStackNames(app)).toEqual(['(tabs)', 'settings/index']);
    expect(app.getPathname()).toBe('/settings');

    // 실행 — '/' 는 (onboarding)/index 로 풀리는데 HOME 에서는 그 그룹이 잠겨 있다.
    expect(() => act(() => router.replace('/'))).not.toThrow();

    // 단언 — 던지지 않는 것만으론 부족하다(조용한 무시). 설정 화면이 그대로여야 한다.
    expect(app.getPathname()).toBe('/settings');
    expect(rootStackNames(app)).toEqual(['(tabs)', 'settings/index']);
    expect(screen.getByTestId('settings-root')).toBeOnTheScreen();
  });

  describe("재동의 중 replace('/') 는 무시되고, 게이트가 뒤집힐 때 전환이 화면을 옮긴다", () => {
    it.each<[BootstrapDestination, string[], string, string, string | null]>([
      ['HOME', ['(tabs)'], '/', 'home-root', 'onboarding-index'],
      ['ONBOARDING', ['(onboarding)'], '/', 'onboarding-index', 'home-root'],
      ['LOGIN', ['(auth)'], '/login', 'login-root', 'home-root'],
    ])(
      '재동의 → %s: replace 직후엔 그대로, 뒤집은 뒤에 도착한다',
      (destination, stack, pathname, shown, absent) => {
        // 준비 — 재동의 게이트로 앱을 열고 스플래시 하한을 넘긴다. 앵커: 재동의 화면 하나.
        gateDestination = 'RECONSENT';
        const app = renderRouter(ROUTES, { initialUrl: '/reconsent' });
        act(() => {
          jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
        });
        expect(app.getPathname()).toBe('/reconsent');
        expect(rootStackNames(app)).toEqual(['reconsent']);

        // 실행 1 — 동의 직후 ReconsentPage 가 하는 그 호출.
        expect(() => act(() => router.replace('/'))).not.toThrow();

        // 단언 1 — 아직 아무 일도 없었다(이동은 조용히 무시). 이걸 먼저 못 박아야 "replace 가 일한다"는 오해가 안 생긴다.
        expect(app.getPathname()).toBe('/reconsent');
        expect(rootStackNames(app)).toEqual(['reconsent']);

        // 실행 2 — 서버 재조회가 끝나 게이트가 뒤집힌다(act 로 감싸야 구독한 SplashGate 의 재렌더가 반영된다).
        act(() => {
          flipGateTo(destination);
        });

        // 단언 2 — 가드 전환이 화면을 옮겼다. 재동의는 스택에서 사라지고 뒤로 갈 곳이 없다.
        expect(rootStackNames(app)).toEqual(stack);
        expect(app.getPathname()).toBe(pathname);
        expect(screen.getByTestId(shown)).toBeOnTheScreen();
        if (absent) expect(screen.queryByTestId(absent)).toBeNull();
        expect(router.canGoBack()).toBe(false);
      }
    );
  });
});

/**
 * TRIP-1601 — 온보딩을 이미 마친 계정이 HOME 에 들어올 때, 위치·알림 OS 권한이 **미결정**인 것만 홈보다 먼저 안내한다(위치 → 알림).
 *
 * 왜 진짜 라우터인가: ① 안내 카드(온보딩 `LocationPage`·`PushPage` 재사용)의 [계속]이 HOME 가드 안 목적지로 가는지 —
 * 하드코딩된 `(onboarding)` 그룹이나 `'/'` 로 가면 라우터가 에러 없이 무시한다(TRIP-1597). ② 안내가 스택에 한 장만 남고 홈에서 뒤로 못 돌아오는지.
 * ③ 푸시 탭 딥링크와의 경합. 이 셋은 라우터 목으로는 안 보인다. 안내 라우트 두 개는 앱의 실제 파일(`app/permission-*.tsx`)을
 * `@routes` 별칭으로 꽂는다. `'/'` 가 실제처럼 겹치는 것은 공유 ROUTES 가 `(onboarding)/index` 를 두기 때문이다(TRIP-1628).
 *
 * 무엇을 보장하나 (AC 번호는 01b 기준):
 *  - AC1·AC3·AC4 흐름 5종(둘 다·위치만·알림만·거부·거부 후 계속)이 각각 올바른 순서로 카드를 보이고 OS 요청/루틴을 1회씩 부르고
 *    끝에 `(tabs)` 하나만 남긴다(뒤로 갈 곳 없음).
 *  - AC2 이미 결정됨(허용·거부 무관)·조회 실패·모름은 아무것도 안 뜬다(사용자를 막지 않는 방향, INV-4) — 저장소에도 흔적을 안 남긴다.
 *  - AC6 이 마운트에서 ONBOARDING 이었으면(신규 가입 직후) 안 뜬다. AC8 HOME 이 아니면 이동 0회, HOME 재진입은 다시 평가.
 *  - AC7 최상위가 홈 탭이 아니면(푸시 탭·딥링크) 이번 실행은 건너뛴다 — 상태를 남기지 않는다.
 *  - AC8(설치당 1회) 한 번 안내했으면 다음 실행(재마운트)에선 미결정이어도 안 뜨고, 저장소가 비면 다시 뜬다.
 *  - AC9 조회가 하한 안에 끝나면 홈을 거쳐 이동하는 비동기 틈이 없다(동기 act 한 번에 도착). 안 끝나면 상한까지만 스플래시를 붙잡고 홈으로 간다.
 *    LOGIN 처럼 HOME 이 아닌 목적지는 붙잡지 않는다.
 * jest 가 못 보는 것: 홈이 한 프레임 번쩍이는지·OS 창이 카드/홈 위에 어색하게 뜨는지·실제 설치 단위 저장소 의미(6-b).
 */
describe('권한 안내는 진짜 라우터에서 홈보다 먼저, 한 번만 (TRIP-1601)', () => {
  // '/' 로 풀리는 화면이 둘인 것은 공유 ROUTES 가 이미 둔다((onboarding)/index · (tabs)/index) — 여기선 안내 화면 둘만 실제 라우트 파일로 더한다.
  // 파일이 없는 동안(red)에도 다른 케이스가 로드 단계에서 죽지 않게 지연 require 한다.
  function catchUpRoutes() {
    /* eslint-disable @typescript-eslint/no-require-imports */
    return {
      ...ROUTES,
      'permission-location': require('@routes/permission-location').default,
      'permission-push': require('@routes/permission-push').default,
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  /** 비동기 후속(조회 결과 → 상태 → 이동)을 흘린다. 멈춘 시계 아래에서도 쓴다. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {});
    }
  }

  function passFloor(): void {
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });
  }

  /** 앱을 연다 — 마이크로태스크를 먼저 흘려 권한 조회가 하한 안에 끝나게 하고, 스플래시 하한을 넘긴 뒤 후속(이동)을 흘린다. */
  async function openCatchUp(
    initialUrl = '/',
    destination: BootstrapDestination = 'HOME'
  ): Promise<RouterApp> {
    gateDestination = destination;
    const app = renderRouter(catchUpRoutes(), { initialUrl });
    await settle();
    passFloor();
    await settle();
    return app;
  }

  function osState(location: LocationStatus, push: OsPermission): void {
    primeLocation(location, 'granted');
    primeOsPermission(Notifications, push, 'granted');
  }

  /** "봤음" 기록이 어디에도 안 남았다 — 문서 폴더에도, 키체인에도. */
  function expectNoFlag(): void {
    expect(documentFileCount()).toBe(0);
    expect(mockVault.size).toBe(0);
  }

  function expectHomeOnly(app: RouterApp): void {
    expect(rootStackNames(app)).toEqual(['(tabs)']);
    expect(app.getPathname()).toBe('/');
    expect(screen.getByTestId('home-root')).toBeOnTheScreen();
    expect(router.canGoBack()).toBe(false);
  }

  beforeEach(() => {
    mockCatchUp.mockImplementation(realCatchUp);
  });

  describe('안내 흐름 (AC1 · AC3 · AC4)', () => {
    it('F1 둘 다 미결정: 위치 카드 → 알림 카드 → 홈. OS 요청·루틴 1회씩, 끝에 홈 하나만 남고 뒤로 못 간다', async () => {
      // 준비
      osState('undetermined', 'undetermined');

      // 실행 1 — 앱을 연다
      const app = await openCatchUp();

      // 단언 1 — 홈보다 먼저 위치 카드. 앵커: 아직 아무 권한도 묻지 않았고 스택에 카드 하나뿐
      expect(app.getPathname()).toBe('/permission-location');
      expect(rootStackNames(app)).toEqual(['permission-location']);
      expect(screen.getByTestId('onboarding-location-root')).toBeOnTheScreen();
      expect(screen.queryByTestId('onboarding-location-later')).toBeNull(); // 건너뛰기 없음(5.1.1(iv))
      expect(screen.queryByTestId('home-root')).toBeNull();
      expect(mockRequestForeground).toHaveBeenCalledTimes(0);
      expect(router.canGoBack()).toBe(false);

      // 실행 2 — 위치 [계속] → OS 가 허용
      fireEvent.press(screen.getByTestId('onboarding-location-allow'));
      await settle();

      // 단언 2 — OS 요청 1회, 알림 카드로(온보딩 그룹이 아니라 안내 라우트)
      expect(mockRequestForeground).toHaveBeenCalledTimes(1);
      expect(app.getPathname()).toBe('/permission-push');
      expect(rootStackNames(app)).toEqual(['permission-push']);
      expect(screen.getByTestId('onboarding-push-root')).toBeOnTheScreen();
      expect(screen.queryByTestId('onboarding-push-later')).toBeNull();
      expect(mockPrompt).toHaveBeenCalledTimes(0);

      // 실행 3 — 알림 [계속] (진입 때 열린 연타 창은 닫고 누른다)
      resetPressGuard();
      fireEvent.press(screen.getByTestId('onboarding-push-allow'));
      await settle();

      // 단언 3 — 루틴 1회, 홈 하나뿐
      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expectHomeOnly(app);
      expect(screen.queryByTestId('onboarding-index')).toBeNull();
    });

    it('F2 위치만 미결정(알림은 결정됨): 위치 카드 → 홈. 알림 루틴은 부르지 않는다', async () => {
      osState('undetermined', 'denied');
      const app = await openCatchUp();
      expect(app.getPathname()).toBe('/permission-location');

      fireEvent.press(screen.getByTestId('onboarding-location-allow'));
      await settle();

      expect(mockRequestForeground).toHaveBeenCalledTimes(1);
      expectHomeOnly(app);
      expect(mockPrompt).toHaveBeenCalledTimes(0);
    });

    it('F3 알림만 미결정(위치는 결정됨): 알림 카드가 첫 화면 → 홈. 위치는 묻지 않는다', async () => {
      osState('granted', 'undetermined');
      const app = await openCatchUp();

      expect(app.getPathname()).toBe('/permission-push');
      expect(rootStackNames(app)).toEqual(['permission-push']);
      expect(mockRequestForeground).toHaveBeenCalledTimes(0);

      resetPressGuard();
      fireEvent.press(screen.getByTestId('onboarding-push-allow'));
      await settle();

      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expect(mockRequestForeground).toHaveBeenCalledTimes(0);
      expectHomeOnly(app);
    });

    it('F4 위치를 OS 에서 거부해도 막히지 않는다: 거부 프레임의 [계속]이 알림 카드로 간다(거부 경로 = 가드 밖 이동으로 무시되지 않는다)', async () => {
      // 준비 — 위치 OS 창에서 거부, 알림은 미결정
      primeLocation('undetermined', 'denied');
      primeOsPermission(Notifications, 'undetermined', 'granted');
      const app = await openCatchUp();
      fireEvent.press(screen.getByTestId('onboarding-location-allow'));
      await settle();

      // 단언 1 — 거부 프레임으로 바뀌었고 아직 같은 카드(라우트)다
      expect(mockRequestForeground).toHaveBeenCalledTimes(1);
      expect(app.getPathname()).toBe('/permission-location');
      expect(
        screen.getByTestId('onboarding-location-continue')
      ).toBeOnTheScreen();

      // 실행 — 거부 프레임 [계속]
      resetPressGuard();
      fireEvent.press(screen.getByTestId('onboarding-location-continue'));
      await settle();

      // 단언 2
      expect(app.getPathname()).toBe('/permission-push');
      expect(rootStackNames(app)).toEqual(['permission-push']);
      expect(mockRequestForeground).toHaveBeenCalledTimes(1);
    });

    it('F5 위치만 미결정이고 거부 프레임 [계속]으로 끝내면 곧장 홈 하나만 남는다', async () => {
      primeLocation('undetermined', 'denied');
      primeOsPermission(Notifications, 'denied');
      const app = await openCatchUp();
      fireEvent.press(screen.getByTestId('onboarding-location-allow'));
      await settle();
      resetPressGuard();

      fireEvent.press(screen.getByTestId('onboarding-location-continue'));
      await settle();

      expectHomeOnly(app);
      expect(mockPrompt).toHaveBeenCalledTimes(0);
    });
  });

  describe('이미 결정됨·조회 실패는 아무것도 안 뜬다 (AC2)', () => {
    it.each([
      ['위치 허용 · 알림 허용', 'granted', 'granted'],
      ['위치 거부 · 알림 거부', 'denied', 'denied'],
      ['위치 허용 · 알림 거부', 'granted', 'denied'],
      ['위치 거부 · 알림 허용', 'denied', 'granted'],
    ] as const)(
      'D1 [%s]: 안내 없이 홈, 저장소 흔적도 없다',
      async (_label, location, push) => {
        osState(location, push);

        const app = await openCatchUp();

        expectHomeOnly(app);
        expectNoFlag();
        expect(mockRequestForeground).toHaveBeenCalledTimes(0);
      }
    );

    it('D2 위치는 foreground 만 본다: foreground 가 허용이면 background 가 미결정이어도 위치 카드는 안 뜬다', async () => {
      osState('granted', 'denied');
      mockGetBackground.mockResolvedValue(locationResponse('undetermined'));

      const app = await openCatchUp();

      expectHomeOnly(app);
    });

    it.each([
      [
        '위치 조회가 throw',
        () => {
          osState('granted', 'denied');
          mockGetForeground.mockRejectedValue(new Error('location api'));
        },
      ],
      [
        '위치 조회가 undefined(값을 못 읽음)',
        () => {
          osState('granted', 'denied');
          mockGetForeground.mockResolvedValue(undefined);
        },
      ],
      [
        '알림 조회가 throw',
        () => {
          osState('granted', 'denied');
          (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValue(
            new Error('push api')
          );
        },
      ],
    ])(
      'D3 [%s]: 안내 없이 홈(사용자를 막지 않는 방향 — INV-4)',
      async (_label, breakLookup) => {
        // 준비 — 깨진 쪽이 아닌 쪽은 이미 결정됨으로 둔다(깨진 쪽만 홈으로 접히는지 보려고)
        breakLookup();

        const app = await openCatchUp();

        expectHomeOnly(app);
        expectNoFlag();
      }
    );

    it('D4 "봤음" 기록(파일)을 읽다 실패해도 안내 없이 홈이다(알 수 없으면 묻지 않는다)', async () => {
      osState('undetermined', 'undetermined');
      failFileReads();

      const app = await openCatchUp();

      expectHomeOnly(app);
      expectNoFlag();
    });
  });

  describe('한 쪽만 조회 실패하면 미결정인 쪽만 안내한다 (AC2 확장)', () => {
    it('D5a 위치 조회가 실패하고 알림이 미결정이면 알림 카드만 뜨고 [계속] 뒤 홈이다(실패한 쪽은 안 보임)', async () => {
      // 준비
      osState('granted', 'undetermined');
      mockGetForeground.mockRejectedValue(new Error('location api'));

      // 실행
      const app = await openCatchUp();

      // 단언 1 — 알림 카드가 첫 화면, 위치 카드는 없다
      expect(app.getPathname()).toBe('/permission-push');
      expect(rootStackNames(app)).toEqual(['permission-push']);

      // 실행 2 — 알림 [계속]
      resetPressGuard();
      fireEvent.press(screen.getByTestId('onboarding-push-allow'));
      await settle();

      // 단언 2
      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expectHomeOnly(app);
    });

    it('D5b 알림 조회가 실패하고 위치가 미결정이면 위치 카드만 뜨고 [계속] 뒤 곧장 홈이다(알림 카드로 가지 않는다)', async () => {
      // 준비
      osState('undetermined', 'denied');
      (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValue(
        new Error('push api')
      );

      // 실행
      const app = await openCatchUp();
      expect(app.getPathname()).toBe('/permission-location');
      fireEvent.press(screen.getByTestId('onboarding-location-allow'));
      await settle();

      // 단언
      expect(mockRequestForeground).toHaveBeenCalledTimes(1);
      expectHomeOnly(app);
      expect(mockPrompt).toHaveBeenCalledTimes(0);
    });
  });

  describe('"봤음" 기록 쓰기가 실패해도 안내는 그대로 진행된다 (AC8 확장)', () => {
    it('W1 기록을 쓰지 못해도(디스크 가득 등) 안내가 뜨고 끝까지 진행된다', async () => {
      // 준비
      osState('undetermined', 'undetermined');
      failFileWrites();

      // 실행 1
      const app = await openCatchUp();

      // 단언 1 — 기록은 못 남겼어도 안내는 뜬다
      expect(app.getPathname()).toBe('/permission-location');

      // 실행 2 — 끝까지 진행
      fireEvent.press(screen.getByTestId('onboarding-location-allow'));
      await settle();
      resetPressGuard();
      fireEvent.press(screen.getByTestId('onboarding-push-allow'));
      await settle();

      // 단언 2
      expectHomeOnly(app);
    });
  });

  describe('신규 가입·HOME 이 아닌 목적지·재진입 (AC6 · AC8)', () => {
    it('G1 이 마운트에서 ONBOARDING 이었으면(신규 가입 직후) HOME 이 돼도 안내가 뜨지 않고, 이어지는 기능 안내 이동이 그대로 된다', async () => {
      // 준비 — 온보딩 중. 권한은 둘 다 미결정(안내가 뜰 수 있는 조건)
      osState('undetermined', 'undetermined');
      const app = await openCatchUp('/welcome', 'ONBOARDING');
      expect(rootStackNames(app)).toEqual(['(onboarding)']);

      // 실행 1 — 완료 응답 뒤 게이트가 HOME 을 연다(PrefStep2Page 의 순서)
      act(() => {
        flipGateTo('HOME');
      });
      await settle();

      // 단언 1 — 안내로 새지 않았다(기능 안내 이동 전 틈에서 확인)
      expect(rootStackNames(app)).toEqual(['(tabs)']);
      expect(app.getPathname()).toBe('/');
      expectNoFlag();
      expect(mockRequestForeground).toHaveBeenCalledTimes(0);

      // 실행 2 — 기능 안내로 replace
      act(() => router.replace('/onboarding-tour' as never));
      await settle();

      // 단언 2
      expect(rootStackNames(app)).toEqual(['onboarding-tour']);
      expect(app.getPathname()).toBe('/onboarding-tour');
    });

    it.each([
      ['LOGIN', '/login'],
      ['RECONSENT', '/reconsent'],
      ['FORCE_UPDATE', '/force-update'],
    ] as const)(
      'G2 목적지 %s 에서는 이동 0회·저장소 흔적 0 — 권한이 미결정이어도 그 목적지 화면에 머문다',
      async (destination, path) => {
        osState('undetermined', 'undetermined');

        const app = await openCatchUp(path, destination);
        act(() => {
          jest.advanceTimersByTime(PERMISSION_LOOKUP_WAIT_MAX_MS * 3);
        });
        await settle();

        expect(app.getPathname()).toBe(path);
        expectNoFlag();
        expect(mockRequestForeground).toHaveBeenCalledTimes(0);
      }
    );

    it('G3 로그아웃 뒤 다시 로그인해 HOME 에 돌아오면 다시 평가한다(그 사이 권한이 미결정이 되었다면 안내가 뜬다)', async () => {
      // 준비 — 첫 HOME: 둘 다 결정됨 → 안내 없음(앵커)
      osState('granted', 'granted');
      const app = await openCatchUp();
      expectHomeOnly(app);

      // 실행 1 — 로그아웃
      act(() => {
        flipGateTo('LOGIN');
      });
      await settle();
      expect(app.getPathname()).toBe('/login');

      // 실행 2 — OS 가 위치를 미결정으로 되돌렸다(설정에서 초기화 등) 뒤 다시 로그인
      osState('undetermined', 'granted');
      act(() => {
        flipGateTo('HOME');
      });
      await settle();

      // 단언
      expect(app.getPathname()).toBe('/permission-location');
      expect(rootStackNames(app)).toEqual(['permission-location']);
    });

    it('G4 세션 안 로그인(LOGIN → HOME)은 스플래시로 되돌아가지 않고 스택이 유지된 채 안내가 뜬다', async () => {
      // 준비 — 로그인 화면으로 시작, 위치 조회는 아직 안 끝난다
      osState('undetermined', 'denied');
      const pending = deferred<ReturnType<typeof locationResponse>>();
      const app = await openCatchUp('/login', 'LOGIN');
      expect(app.getPathname()).toBe('/login');
      mockGetForeground.mockImplementation(() => pending.promise);

      // 실행 1 — 로그인 성공으로 HOME
      act(() => {
        flipGateTo('HOME');
      });
      await settle();

      // 단언 1 — 스택이 언마운트되는 스플래시 복귀는 없다
      expect(screen.queryByTestId('shell-splash-root')).toBeNull();

      // 실행 2 — 조회가 미결정으로 끝난다
      pending.resolve(locationResponse('undetermined'));
      await settle();

      // 단언 2
      expect(app.getPathname()).toBe('/permission-location');
      expect(rootStackNames(app)).toEqual(['permission-location']);
    });
  });

  describe('딥링크·푸시 탭과의 경합 (AC7)', () => {
    it('C1 최상위가 홈 탭이 아니면(딥링크로 설정 화면에서 시작) 이번 실행은 안내를 건너뛰고 저장소에도 안 남긴다', async () => {
      osState('undetermined', 'undetermined');

      const app = await openCatchUp('/settings');
      await settle();

      expect(app.getPathname()).toBe('/settings');
      expect(rootStackNames(app)).not.toContain('permission-location');
      expect(rootStackNames(app)).not.toContain('permission-push');
      expectNoFlag();
    });

    it('C2 푸시를 눌러 앱이 켜진 실행(콜드 스타트 탭)은 그 알림 화면에 머문다 — 안내가 덮어쓰지 않는다', async () => {
      // 준비 — OS 가 앱을 켠 탭을 들고 있고, 권한은 둘 다 미결정
      osState('undetermined', 'undetermined');
      (
        Notifications.getLastNotificationResponseAsync as jest.Mock
      ).mockResolvedValueOnce(fakePushResponse('n-cold-1601', PLAN_B_TAP));

      // 실행
      const app = await openCatchUp();
      await settle();

      // 단언 — 알림이 가리키는 곳에 있고 안내는 스택 어디에도 없다
      expect(app.getPathname()).toBe('/trips/trip-1/planb');
      expect(rootStackNames(app)).not.toContain('permission-location');
      expect(rootStackNames(app)).not.toContain('permission-push');
      expectNoFlag();
    });
  });

  describe('설치당 한 번 (AC8)', () => {
    it('P1 한 번 안내했으면 다음 실행(재마운트)에서는 미결정이어도 안 뜬다', async () => {
      // 준비 — 첫 실행: 안내가 뜬다(앵커) 그리고 "봤음"이 기기 저장소에 남는다
      osState('undetermined', 'undetermined');
      const first = await openCatchUp();
      expect(first.getPathname()).toBe('/permission-location');
      expect(documentFileCount()).toBeGreaterThan(0);
      expect(mockVault.size).toBe(0); // 키체인에는 쓰지 않는다

      // 실행 — 앱을 껐다 켠다(OS 권한은 여전히 미결정: iOS "한 번만 허용" 같은 경우)
      first.unmount();
      resetPressGuard();
      const second = await openCatchUp();
      await settle();

      // 단언
      expectHomeOnly(second);
    });

    it('P2 저장소가 비어 있으면(재설치·새 기기) 다시 뜬다 — 모듈 메모리가 아니라 저장소가 기억한다', async () => {
      // 준비
      osState('undetermined', 'undetermined');
      const first = await openCatchUp();
      expect(first.getPathname()).toBe('/permission-location');
      first.unmount();
      resetFakeFs(); // 앱 삭제 = 샌드박스가 비워진다
      resetPressGuard();

      // 실행
      const second = await openCatchUp();

      // 단언
      expect(second.getPathname()).toBe('/permission-location');
    });
  });

  describe('스플래시와 조회 타이밍 (AC9)', () => {
    it('T1 조회는 마운트 때 시작한다 — 스플래시 하한이 지나기 전에 이미 OS 에 물었고, 하한이 지나면 안내가 도착한다', async () => {
      // 준비
      osState('undetermined', 'undetermined');
      gateDestination = 'HOME';
      const app = renderRouter(catchUpRoutes(), { initialUrl: '/' });
      await settle();

      // 단언 1 — 하한 전: 위치·알림 조회가 이미 나갔고(하한 뒤에 시작하는 구현이면 0회) 화면은 아직 스플래시다
      expect(mockGetForeground).toHaveBeenCalled();
      expect(Notifications.getPermissionsAsync).toHaveBeenCalled();
      expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();

      // 실행
      passFloor();
      await settle();

      // 단언 2
      expect(app.getPathname()).toBe('/permission-location');
    });

    it('T2 조회가 하한까지 안 끝나면 상한까지만 스플래시를 붙잡고, 그 안에 끝나면 홈 없이 안내로 간다', async () => {
      // 준비 — 위치 조회가 붙잡혀 있다
      osState('undetermined', 'denied');
      const pending = deferred<ReturnType<typeof locationResponse>>();
      mockGetForeground.mockImplementation(() => pending.promise);
      gateDestination = 'HOME';
      const app = renderRouter(catchUpRoutes(), { initialUrl: '/' });
      await settle();

      // 실행 1 — 하한이 지났다
      passFloor();

      // 단언 1 — 아직 스플래시, 스택(홈)은 마운트 안 됨
      expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();
      expect(screen.queryByTestId('home-root')).toBeNull();

      // 실행 2 — 상한 직전
      act(() => {
        jest.advanceTimersByTime(PERMISSION_LOOKUP_WAIT_MAX_MS - 1);
      });

      // 단언 2 — 아직 스플래시
      expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();

      // 실행 3 — 상한 안에 조회가 끝난다
      pending.resolve(locationResponse('undetermined'));
      await settle();

      // 단언 3 — 홈에 머물지 않고 안내
      expect(screen.queryByTestId('shell-splash-root')).toBeNull();
      expect(app.getPathname()).toBe('/permission-location');
    });

    it('T3 조회가 끝내 안 오면 상한에서 스플래시를 풀고 안내 없이 홈으로 간다(무한 스플래시 금지)', async () => {
      // 준비
      osState('undetermined', 'undetermined');
      mockGetForeground.mockImplementation(() => new Promise(() => {}));
      gateDestination = 'HOME';
      const app = renderRouter(catchUpRoutes(), { initialUrl: '/' });
      await settle();
      passFloor();
      act(() => {
        jest.advanceTimersByTime(PERMISSION_LOOKUP_WAIT_MAX_MS - 1);
      });
      expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();

      // 실행 — 상한
      act(() => {
        jest.advanceTimersByTime(1);
      });
      await settle();

      // 단언
      expect(screen.queryByTestId('shell-splash-root')).toBeNull();
      expectHomeOnly(app);
      expectNoFlag();
    });

    it('T4 HOME 이 아닌 목적지(LOGIN)는 조회가 멈춰 있어도 하한 직후 바로 보인다 — 스플래시를 더 붙잡지 않는다', async () => {
      osState('undetermined', 'undetermined');
      mockGetForeground.mockImplementation(() => new Promise(() => {}));
      gateDestination = 'LOGIN';
      renderRouter(catchUpRoutes(), { initialUrl: '/login' });
      await settle();

      passFloor();

      expect(screen.queryByTestId('shell-splash-root')).toBeNull();
      expect(screen.getByTestId('login-root')).toBeOnTheScreen();
    });
  });
});
