import { act, render } from '@testing-library/react-native';

import { useBootstrapGate } from '@/features/auth/model/useBootstrapGate';
import {
  promptAndRegisterPush,
  registerPushIfGranted,
  requestPushPermission,
} from '@/shared/push';

import { SplashGate, SPLASH_MIN_VISIBLE_MS } from './SplashGate';

/**
 * TRIP-835 · AC-4 — 인증된 앱 진입(HOME)마다 **조용히** 푸시 토큰을 다시 올린다.
 *
 * 무엇을 보장하나:
 *  - 목적지가 HOME 이 되면 `registerPushIfGranted()` 를 1회 부른다(같은 HOME 으로 다시 그려도 1회).
 *    이미 허용한 기존 사용자·Android 12 이하 사용자가 여기서 등록된다(브리프 ③).
 *  - HOME 이 아닌 목적지·로딩 중에는 부르지 않는다.
 *  - 로그인(LOGIN→HOME), 로그아웃 뒤 재로그인(HOME→LOGIN→HOME)마다 다시 부른다 — 서버는 같은 토큰을
 *    새 계정으로 옮긴다(openapi 멱등 계약).
 *  - 앱을 켤 때는 **절대 묻지 않는다** — 요청 루틴(`promptAndRegisterPush`·`requestPushPermission`) 0회.
 *
 * 왜 목인가: 게이트가 "언제 부르나"만 본다. 루틴이 조회만 하는지는 `shared/push/wiring.test.ts` S1~S2.
 *
 * ★ floor 타이머는 fake timers 로 넘긴다(SplashGate.test 선례, 02a ★13). HOME 재진입은 훅 목 반환값을
 *   바꾼 뒤 `rerender` 로 흉내 낸다 — 루트 셸은 실제 앱에서도 언마운트되지 않는다.
 *
 * 3동작 뼈대: 준비=게이트 훅 상태 → 실행=렌더(+floor 경과·rerender) → 단언=등록 루틴 호출 횟수.
 */

jest.mock('@/features/auth/model/useBootstrapGate', () => ({
  __esModule: true,
  BOOTSTRAP_TIMEOUT_MS: 3000,
  useBootstrapGate: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-router', () => require('@/test-support/expoRouterStackMock'));

jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

const mockUseBootstrapGate = useBootstrapGate as jest.MockedFunction<
  typeof useBootstrapGate
>;
const mockRegisterIfGranted = registerPushIfGranted as jest.Mock;

type GateState = ReturnType<typeof useBootstrapGate>;

function gate(overrides: Partial<GateState> = {}): GateState {
  return {
    phase: 'resolved',
    destination: 'HOME',
    isProvisional: false,
    ...overrides,
  };
}

function passFloor(): void {
  act(() => {
    jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  mockUseBootstrapGate.mockReset();
  jest.useRealTimers();
});

describe('TRIP-835 AC-4 · HOME 진입 → 조용한 재등록', () => {
  it('H1 HOME 이면 등록 루틴 1회, 같은 HOME 으로 다시 그려도 1회 — 요청 루틴은 0회', () => {
    // 준비
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));

    // 실행
    const view = render(<SplashGate />);
    passFloor();
    view.rerender(<SplashGate />);

    // 단언
    expect(mockRegisterIfGranted).toHaveBeenCalledTimes(1);
    expect(promptAndRegisterPush).not.toHaveBeenCalled();
    expect(requestPushPermission).not.toHaveBeenCalled();
  });

  it.each(['FORCE_UPDATE', 'RECONSENT', 'LOGIN', 'ONBOARDING'] as const)(
    'H2 목적지 %s 이면 등록 루틴 0회',
    (destination) => {
      mockUseBootstrapGate.mockReturnValue(gate({ destination }));

      render(<SplashGate />);
      passFloor();

      expect(mockRegisterIfGranted).not.toHaveBeenCalled();
    }
  );

  it('H3 아직 로딩 중(목적지 미결)이면 등록 루틴 0회', () => {
    mockUseBootstrapGate.mockReturnValue(
      gate({ phase: 'loading', destination: null })
    );

    render(<SplashGate />);
    passFloor();

    expect(mockRegisterIfGranted).not.toHaveBeenCalled();
  });

  it('H4 로그인 성공(LOGIN → HOME)으로 HOME 이 되면 그때 1회', () => {
    // 준비: 로그인 화면에 있다.
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'LOGIN' }));
    const view = render(<SplashGate />);
    passFloor();
    expect(mockRegisterIfGranted).not.toHaveBeenCalled();

    // 실행: 로그인 성공 → 게이트가 다시 조회해 HOME.
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));
    view.rerender(<SplashGate />);

    // 단언
    expect(mockRegisterIfGranted).toHaveBeenCalledTimes(1);
  });

  it('H5 로그아웃 뒤 다시 로그인하면(HOME → LOGIN → HOME) 다시 부른다 — 총 2회', () => {
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));
    const view = render(<SplashGate />);
    passFloor();

    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'LOGIN' }));
    view.rerender(<SplashGate />);
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));
    view.rerender(<SplashGate />);

    expect(mockRegisterIfGranted).toHaveBeenCalledTimes(2);
  });
});
