import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useBootstrapGate } from '@/features/auth/model/useBootstrapGate';
import { usePreferenceStore } from '@/features/onboarding/model/preferenceStore';

import { SplashGate, SPLASH_MIN_VISIBLE_MS } from './SplashGate';

/**
 * TRIP-1077 — 계정 경계 정리. 게이트 목적지가 비LOGIN → LOGIN 으로 바뀌면 SplashGate 가 스택을 걷고
 * (`dismissAll` → `replace('/login')`) 이전 계정의 서버 캐시와 취향 세션 스토어를 비운다.
 *
 * 무엇을 보장하나:
 *  - A: 스택을 그린 뒤의 비LOGIN → LOGIN 전이마다 정리한다. 걷을 화면이 있을 때만 dismissAll 을 부르고,
 *    그 **뒤에** replace 한다. 두 호출은 `(auth)` 가 이미 마운트된 커밋 뒤에 일어난다.
 *  - N: 첫 부트·스플래시 중 전이·LOGIN→HOME·같은 계정 전이·같은 값 재렌더에서는 아무것도 하지 않는다.
 *
 * 이 트리엔 설정 화면(runLogout)이 없다 — 여기서 정리가 일어났다면 게이트 혼자 한 것이다(세션 만료 경로).
 * 실제 스택 모양·액션 큐 dispatch 는 목이 흉내 내지 않는다(6-b 실기 전용, 02a ★12).
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
    dismissAll: jest.fn(),
    replace: jest.fn(),
  },
}));

jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

const mockUseBootstrapGate = useBootstrapGate as jest.MockedFunction<
  typeof useBootstrapGate
>;
const mockCanDismiss = router.canDismiss as jest.Mock;
const mockDismissAll = router.dismissAll as jest.Mock;
const mockReplace = router.replace as jest.Mock;

type GateState = ReturnType<typeof useBootstrapGate>;
type Destination = NonNullable<GateState['destination']>;

/** 이전 계정의 캐시 1건 — 정리 뒤 남으면 다음 계정 화면에 샌다. */
const PREV_ACCOUNT_KEY = ['/api/v1/me/profile'];

let queryClient: QueryClient;
/** 스파이가 불린 그 순간 로그인 라우트가 이미 마운트돼 있었는가(02a ★2). */
let authMountedAt: { dismissAll: boolean | null; replace: boolean | null };

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
  expect(mockDismissAll).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(cacheSize()).toBe(1);
  expect(usePreferenceStore.getState().pace).toBe('relaxed');
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  queryClient = new QueryClient();
  authMountedAt = { dismissAll: null, replace: null };
  mockCanDismiss.mockReturnValue(true);
  mockDismissAll.mockImplementation(() => {
    authMountedAt.dismissAll = authRouteMounted();
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
    expect(mockDismissAll).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(cacheSize()).toBe(1);
    expect(usePreferenceStore.getState().pace).toBe('relaxed');

    // 실행
    switchTo(view, 'LOGIN');

    // 단언 — 호출 유무·인자
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/login');
    // 단언 — 순서: 걷기가 먼저, 바꿔 끼우기가 나중(반대면 방금 넣은 로그인 화면까지 걷힌다)
    expect(mockDismissAll.mock.invocationCallOrder[0]).toBeLessThan(
      mockReplace.mock.invocationCallOrder[0]
    );
    // 단언 — 시점: 로그인 라우트가 이미 마운트된 커밋 뒤에 불렸다
    expect(authMountedAt).toEqual({ dismissAll: true, replace: true });
    // 단언 — 이전 계정 흔적
    expect(cacheSize()).toBe(0);
    expect(usePreferenceStore.getState().pace).toBeNull();
  });

  it.each(['ONBOARDING', 'RECONSENT', 'FORCE_UPDATE'] as const)(
    'A2 %s → LOGIN 도 똑같이 정리한다',
    (from) => {
      const view = mountDrawn(from);

      switchTo(view, 'LOGIN');

      expect(mockDismissAll).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/login');
      expect(cacheSize()).toBe(0);
      expect(usePreferenceStore.getState().pace).toBeNull();
    }
  );

  it('A3 걷을 화면이 없으면(canDismiss 거짓) dismissAll 은 부르지 않고 replace 만 1회 한다', () => {
    mockCanDismiss.mockReturnValue(false);
    const view = mountDrawn('HOME');

    switchTo(view, 'LOGIN');

    expect(mockDismissAll).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/login');
    expect(cacheSize()).toBe(0);
    expect(usePreferenceStore.getState().pace).toBeNull();
  });

  it('A4 로그아웃 → 다른 계정 로그인 → 다시 로그아웃이면 두 번째에도 정리한다(한 번 정리로 끝나지 않는다)', () => {
    // 준비: 첫 로그아웃 → 계정 B 로그인, B 의 캐시·취향이 쌓인다.
    const view = mountDrawn('HOME');
    switchTo(view, 'LOGIN');
    switchTo(view, 'HOME');
    seedPreviousAccount();
    expect(cacheSize()).toBe(1);

    // 실행: 두 번째 로그아웃
    switchTo(view, 'LOGIN');

    // 단언
    expect(mockDismissAll).toHaveBeenCalledTimes(2);
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
    expect(mockDismissAll).not.toHaveBeenCalled();
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
    seedPreviousAccount();

    // 실행
    switchTo(view, 'LOGIN');

    // 단언: 호출 수 그대로, 다시 심은 값도 그대로
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(cacheSize()).toBe(1);
    expect(usePreferenceStore.getState().pace).toBe('relaxed');
  });
});
