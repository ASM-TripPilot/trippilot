import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useBootstrapGate } from '@/features/auth';
import { usePreferenceStore } from '@/features/edit-preferences';

import { SplashGate, SPLASH_MIN_VISIBLE_MS } from './SplashGate';

/**
 * TRIP-1077 — 계정 경계 정리. 게이트 목적지가 비LOGIN → LOGIN 으로 바뀌면 SplashGate 가 스택을 걷고
 * (루트 스택 `POP_TO_TOP` → `replace('/login')`) 이전 계정의 서버 캐시와 취향 세션 스토어를 비운다.
 * TRIP-1502 — 걷기 통로가 `router.dismissAll()`(포커스된 가장 안쪽 스택부터 받는다)에서 컨테이너 ref 의
 * `dispatch({ type: 'POP_TO_TOP', target: <루트 스택 key> })` 로 바뀌었다. 이 파일은 그 통로를 목으로 본다.
 *
 * 무엇을 보장하나:
 *  - A: 스택을 그린 뒤의 비LOGIN → LOGIN 전이마다 정리한다. **루트 스택에 쌓인 화면이 있을 때만**(루트 index > 0)
 *    걷기를 보내되 `target` 이 루트 스택의 key 여야 하고, 그 **뒤에** replace 한다. 두 호출은 `(auth)` 가 이미 마운트된 커밋 뒤에 일어난다.
 *  - N: 첫 부트·스플래시 중 전이·LOGIN→HOME·같은 계정 전이·같은 값 재렌더에서는 아무것도 하지 않는다.
 *
 * 이 트리엔 설정 화면(runLogout)이 없다 — 여기서 정리가 일어났다면 게이트 혼자 한 것이다(세션 만료 경로).
 * 실제 스택 모양·액션이 어느 스택에 먹는지는 목이 흉내 내지 않는다 — 진짜 라우터 쪽은 `SplashGate.integration.test` 가 본다.
 * 여기서 컨테이너 ref(`useNavigationContainerRef`)는 `{ getRootState, dispatch }` 두 개짜리 가짜다. *(개념)* 컨테이너 ref —
 * 앱 전체 내비게이션 상태를 읽고(`getRootState`) 액션을 직접 보낼(`dispatch`) 수 있는 손잡이. `target` 으로 받을 스택을 지정한다.
 *
 * 3동작 뼈대: 준비=캐시 1건·취향 값·게이트 목적지로 스택 그림 → 실행=목적지 교체 후 rerender → 단언.
 */

jest.mock('@/features/auth/model/useBootstrapGate', () => ({
  __esModule: true,
  BOOTSTRAP_TIMEOUT_MS: 3000,
  useBootstrapGate: jest.fn(),
}));

// Stack 마커 + router 스파이. 스파이는 팩토리 안에서 만든다 — SplashGate 가 import 시점에 이 모듈을 읽어서
// 바깥 const 를 참조하면 초기화 전 접근이 된다(02a ★4).
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('@/test-support/expoRouterStackMock'),
  router: {
    canDismiss: jest.fn(),
    canGoBack: jest.fn(),
    replace: jest.fn(),
  },
  // 훅이 렌더 때 부르는 컨테이너 ref — 같은 객체를 돌려줘야 effect 의존성이 흔들리지 않는다(바깥 변수는 호출 시점에 읽혀 안전).
  useNavigationContainerRef: () => mockNavigationRef,
}));

// 생성 완료 감지(TRIP-1618)는 useGenerationWatch.integration.test 가 본다 — 여기선 QueryClient·라우터 문맥이 없어 끈다.
jest.mock('@/app/model/useGenerationWatch', () => ({
  useGenerationWatch: jest.fn(),
}));
// 권한 안내(TRIP-1601)는 SplashGate.test(선언·스플래시 유지)와 SplashGate.integration.test(진짜 라우터)가 본다 — 여기선 끈다.
// 진짜 훅은 조회가 비동기라 첫 마운트에서 스플래시를 붙잡는데, 이 파일은 동기 advanceTimers 흐름이고 router 목에 없는 API 를 부를 수 있다.
jest.mock('@/app/model/usePermissionCatchUp', () => ({
  usePermissionCatchUp: jest.fn(() => false),
}));

// 하한 기준점(JS 모듈 로드 시각)은 모듈 최상위 값이라 테스트가 바꿀 수 없다 — 목으로 갈아 beforeEach 에서 "지금"으로 맞춘다
// (그래야 마운트 시점 경과 0 = 옛 동작과 같다). 경과를 흉내 내는 테스트는 mockBootAt 을 과거로 둔다(TRIP-1362).
let mockBootAt = 0;
jest.mock('./bootClock', () => ({
  get BOOT_MODULE_LOADED_AT() {
    return mockBootAt;
  },
}));

// 배럴을 통째로 갈지 않는다 — 실물을 먼저 펼친다. 푸시 탭 라우팅(상황 감지 FE-A)은 실물이 돌지만 전역
// expo-notifications 목이 탭·콜드 스타트 탭을 내지 않아 이동·무효화가 0건이다(캐시 크기 단언 그대로).
jest.mock('@/shared/push', () => ({
  ...jest.requireActual('@/shared/push'),
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

const mockUseBootstrapGate = useBootstrapGate as jest.MockedFunction<
  typeof useBootstrapGate
>;
const mockNavigationRef = { getRootState: jest.fn(), dispatch: jest.fn() };
const mockGetRootState = mockNavigationRef.getRootState;
const mockDispatch = mockNavigationRef.dispatch;
const mockCanDismiss = router.canDismiss as jest.Mock;
const mockCanGoBack = router.canGoBack as jest.Mock;
const mockReplace = router.replace as jest.Mock;

/** 루트 스택(진짜 걷기 대상)의 key — 아래 래퍼 key 들과 일부러 다르게 둬서 "아무 key 나" 쓰는 구현을 잡는다. */
const ROOT_STACK_KEY = 'root-stack-key';

/**
 * expo-router 의 루트 상태 모양: 최상위 컨테이너 상태 → `__root` 래퍼 route → 그 안쪽이 진짜 루트 스택.
 * `index` 가 0 이면 첫 화면 하나뿐(걷을 게 없다), 1 이상이면 그 위에 쌓인 화면이 있다.
 */
function rootState(index: number, stackKey: string = ROOT_STACK_KEY) {
  return {
    key: 'container-state-key',
    routes: [
      {
        key: '__root-route-key',
        name: '__root',
        state: { key: stackKey, index },
      },
    ],
  };
}

type GateState = ReturnType<typeof useBootstrapGate>;
type Destination = NonNullable<GateState['destination']>;

/** 이전 계정의 캐시 1건 — 정리 뒤 남으면 다음 계정 화면에 샌다. */
const PREV_ACCOUNT_KEY = ['/api/v1/me/profile'];

let queryClient: QueryClient;
/** 스파이가 불린 그 순간 로그인 라우트가 이미 마운트돼 있었는가(02a ★2). */
let authMountedAt: { walk: boolean | null; replace: boolean | null };

function gate(overrides: Partial<GateState> = {}): GateState {
  return {
    phase: 'resolved',
    destination: 'HOME',
    isProvisional: false,
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function seedPreviousAccount(): void {
  queryClient.setQueryData(PREV_ACCOUNT_KEY, { nickname: '계정A' });
  usePreferenceStore.setState({ pace: 'relaxed' });
}

function cacheSize(): number {
  return queryClient.getQueryCache().getAll().length;
}

function passFloor(): void {
  act(() => {
    jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
  });
}

function mountDrawn(destination: Destination) {
  mockUseBootstrapGate.mockReturnValue(gate({ destination }));
  const view = render(<SplashGate />, { wrapper });
  passFloor();
  return view;
}

function switchTo(
  view: ReturnType<typeof render>,
  destination: Destination
): void {
  mockUseBootstrapGate.mockReturnValue(gate({ destination }));
  view.rerender(<SplashGate />);
}

function authRouteMounted(): boolean {
  return screen.queryByTestId('gate-route-(auth)') !== null;
}

function expectNothingCleaned(): void {
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(cacheSize()).toBe(1);
  expect(usePreferenceStore.getState().pace).toBe('relaxed');
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockBootAt = Date.now();
  queryClient = new QueryClient();
  authMountedAt = { walk: null, replace: null };
  // 옛 판정 도구(canDismiss·canGoBack)는 일부러 "걸을 게 있다"로 둔다 — 새 판정은 루트 index 라, 이 값에 끌려가면 A3 이 잡는다.
  mockCanDismiss.mockReturnValue(true);
  mockCanGoBack.mockReturnValue(true);
  // 기본 모양: 루트 스택에 화면이 쌓여 있다(첫 화면 + 1).
  mockGetRootState.mockReturnValue(rootState(1));
  mockDispatch.mockImplementation(() => {
    authMountedAt.walk = authRouteMounted();
  });
  mockReplace.mockImplementation(() => {
    authMountedAt.replace = authRouteMounted();
  });
  seedPreviousAccount();
});

// 취향 스토어는 모듈 싱글턴 — describe 밖에서 비워야 앞 테스트 값이 새지 않는다(02a ★3).
afterEach(() => {
  usePreferenceStore.getState().reset();
  queryClient.clear();
  mockUseBootstrapGate.mockReset();
  jest.useRealTimers();
});

describe('TRIP-1077 A · 비LOGIN → LOGIN 전이에서 계정 경계를 정리한다 (AC-2·3·4·6)', () => {
  it('A1 HOME → LOGIN 이면 설정 화면 없이 게이트만으로(세션 만료 경로) 스택을 걷은 뒤 로그인으로 바꾸고, 캐시·취향을 비운다', () => {
    // 준비
    const view = mountDrawn('HOME');
    expect(screen.getByTestId('gate-route-(tabs)')).toBeOnTheScreen();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(cacheSize()).toBe(1);
    expect(usePreferenceStore.getState().pace).toBe('relaxed');

    // 실행
    switchTo(view, 'LOGIN');

    // 단언 — 호출 유무·인자: 걷기는 루트 스택 key 를 겨눈 POP_TO_TOP 이다(래퍼 key 가 아니다, TRIP-1502 — 횟수는 구현 형태라 보지 않는다)
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'POP_TO_TOP',
      target: ROOT_STACK_KEY,
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/login');
    // 단언 — 순서: 걷기가 전부 먼저, 바꿔 끼우기가 나중(반대면 방금 넣은 로그인 화면까지 걷힌다)
    expect(Math.max(...mockDispatch.mock.invocationCallOrder)).toBeLessThan(
      mockReplace.mock.invocationCallOrder[0]
    );
    // 단언 — 시점: 로그인 라우트가 이미 마운트된 커밋 뒤에 불렸다
    expect(authMountedAt).toEqual({ walk: true, replace: true });
    // 단언 — 이전 계정 흔적
    expect(cacheSize()).toBe(0);
    expect(usePreferenceStore.getState().pace).toBeNull();
  });

  it.each(['ONBOARDING', 'RECONSENT', 'FORCE_UPDATE'] as const)(
    'A2 %s → LOGIN 도 똑같이 정리한다',
    (from) => {
      const view = mountDrawn(from);

      switchTo(view, 'LOGIN');

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'POP_TO_TOP',
        target: ROOT_STACK_KEY,
      });
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/login');
      expect(cacheSize()).toBe(0);
      expect(usePreferenceStore.getState().pace).toBeNull();
    }
  );

  // TRIP-1431 — 가드 반영 전 사본(canDismiss)과 탭 이력까지 세는 canGoBack 은 "걷을 게 있다" 하는데 루트 스택엔 첫 화면뿐인 모양.
  // TRIP-1502 — 판정 근거가 canGoBack 에서 루트 스택 index 로 바뀌었다(탭은 POP_TO_TOP 을 처리하지 않아 미처리 dev 경고가 난다).
  it.each([
    ['루트 스택에 첫 화면뿐(index 0)', rootState(0)],
    [
      '루트 스택 index 가 비어 있다(0 으로 본다)',
      {
        key: 'container-state-key',
        routes: [
          {
            key: '__root-route-key',
            name: '__root',
            state: { key: ROOT_STACK_KEY },
          },
        ],
      },
    ],
    [
      '루트 스택이 아직 상태를 안 갖는다(마운트 전)',
      {
        key: 'container-state-key',
        routes: [{ key: '__root-route-key', name: '__root' }],
      },
    ],
    ['루트 상태 자체가 없다', undefined],
  ])(
    'A3 %s 이면 canGoBack·canDismiss 가 참이어도 걷기를 보내지 않고 replace 만 1회 한다',
    (_label, state) => {
      mockCanDismiss.mockReturnValue(true);
      mockCanGoBack.mockReturnValue(true);
      mockGetRootState.mockReturnValue(state);
      const view = mountDrawn('HOME');

      switchTo(view, 'LOGIN');

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/login');
      expect(cacheSize()).toBe(0);
      expect(usePreferenceStore.getState().pace).toBeNull();
    }
  );

  it('A4 로그아웃 → 다른 계정 로그인 → 다시 로그아웃이면 두 번째에도 정리한다(한 번 정리로 끝나지 않는다)', () => {
    // 준비: 첫 로그아웃 → 계정 B 로그인, B 의 캐시·취향이 쌓인다.
    const view = mountDrawn('HOME');
    switchTo(view, 'LOGIN');
    const walksAfterFirst = mockDispatch.mock.calls.length;
    expect(walksAfterFirst).toBeGreaterThan(0);
    switchTo(view, 'HOME');
    seedPreviousAccount();
    expect(cacheSize()).toBe(1);
    // 재로그인으로 루트 스택이 새로 만들어졌다 — key 가 바뀐다(첫 로그아웃 때의 key 를 기억해 두고 쓰면 엉뚱한 곳을 겨눈다)
    const SECOND_STACK_KEY = 'root-stack-key-after-relogin';
    mockGetRootState.mockReturnValue(rootState(2, SECOND_STACK_KEY));

    // 실행: 두 번째 로그아웃
    switchTo(view, 'LOGIN');

    // 단언 — 두 번째에도 걷기가 다시 요청된다(횟수가 아니라 "늘었는가") — 겨눈 곳은 그때의 루트 스택 key
    expect(mockDispatch.mock.calls.length).toBeGreaterThan(walksAfterFirst);
    expect(mockDispatch).toHaveBeenLastCalledWith({
      type: 'POP_TO_TOP',
      target: SECOND_STACK_KEY,
    });
    expect(mockReplace).toHaveBeenCalledTimes(2);
    expect(mockReplace).toHaveBeenLastCalledWith('/login');
    expect(cacheSize()).toBe(0);
    expect(usePreferenceStore.getState().pace).toBeNull();
  });
});

describe('TRIP-1077 N · 정리하지 않는 전이 (AC-5)', () => {
  it('N1a 첫 부트에서 목적지가 미결 → LOGIN 으로 정해지면 아무것도 하지 않는다', () => {
    mockUseBootstrapGate.mockReturnValue(
      gate({ phase: 'loading', destination: null })
    );
    const view = render(<SplashGate />, { wrapper });
    passFloor();

    switchTo(view, 'LOGIN');

    expect(screen.getByTestId('gate-route-(auth)')).toBeOnTheScreen();
    expectNothingCleaned();
  });

  it('N1b 첫 부트에서 바로 LOGIN 으로 열려도 아무것도 하지 않는다', () => {
    mountDrawn('LOGIN');

    expect(screen.getByTestId('gate-route-(auth)')).toBeOnTheScreen();
    expectNothingCleaned();
  });

  it('N2 스플래시가 떠 있는 동안 HOME → LOGIN 으로 교정되면 floor 가 지나도 아무것도 하지 않는다', () => {
    // 준비: 잠정 HOME, floor 직전
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));
    const view = render(<SplashGate />, { wrapper });
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS - 1);
    });

    // 실행 1: 스플래시 중 LOGIN 으로 교정
    switchTo(view, 'LOGIN');
    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    // 실행 2: floor 경과 — 스택이 처음 그려진다
    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(screen.getByTestId('gate-route-(auth)')).toBeOnTheScreen();
    expectNothingCleaned();
  });

  it.each([
    ['LOGIN', 'HOME'],
    ['ONBOARDING', 'HOME'],
  ] as const)('N3 %s → %s 이면 아무것도 하지 않는다', (from, to) => {
    const view = mountDrawn(from);

    switchTo(view, to);

    expect(screen.getByTestId('gate-route-(tabs)')).toBeOnTheScreen();
    expectNothingCleaned();
  });

  it.each([
    ['ONBOARDING', 'gate-route-(onboarding)'],
    ['RECONSENT', 'gate-route-reconsent'],
    ['FORCE_UPDATE', 'gate-route-force-update'],
  ] as const)(
    'N4 같은 계정 전이 HOME → %s 이면 아무것도 하지 않는다(캐시 유지)',
    (to, routeTestId) => {
      const view = mountDrawn('HOME');

      switchTo(view, to);

      expect(screen.getByTestId(routeTestId)).toBeOnTheScreen();
      expectNothingCleaned();
    }
  );

  it('N5a 같은 HOME 으로 다시 그려도 아무것도 하지 않는다', () => {
    const view = mountDrawn('HOME');

    switchTo(view, 'HOME');

    expect(screen.getByTestId('gate-route-(tabs)')).toBeOnTheScreen();
    expectNothingCleaned();
  });

  it('N5b 정리가 끝난 뒤 같은 LOGIN 으로 다시 그려지면 다시 정리하지 않는다', () => {
    // 준비: HOME → LOGIN 정리 1회, 그 뒤 로그인 화면에서 캐시가 다시 생긴 상태
    const view = mountDrawn('HOME');
    switchTo(view, 'LOGIN');
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const walksAfterCleanup = mockDispatch.mock.calls.length;
    expect(walksAfterCleanup).toBeGreaterThan(0);
    seedPreviousAccount();

    // 실행
    switchTo(view, 'LOGIN');

    // 단언: 호출 수 그대로, 다시 심은 값도 그대로
    expect(mockDispatch).toHaveBeenCalledTimes(walksAfterCleanup);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(cacheSize()).toBe(1);
    expect(usePreferenceStore.getState().pace).toBe('relaxed');
  });
});
