import { act, render, screen } from '@testing-library/react-native';

import { useBootstrapGate } from '@/features/auth/model/useBootstrapGate';
import { SplashGate, SPLASH_MIN_VISIBLE_MS } from './SplashGate';

/**
 * AC-W-01·02·03·06 · SplashGate — 부트스트랩 게이트의 렌더 분기 배선.
 *
 * 무엇을 보장하나: 루트 셸이 `useBootstrapGate` 를 구독해
 *  (1) phase==='loading' 이면 SplashScreen 을 보여주고(홈 직행 금지),
 *  (2) resolved 면 destination 에 매핑된 라우트 그룹만 마운트하며(5방향, D1 가드 매핑표),
 *  (3) 5개 목적지 모두 착지 라우트가 있어 크래시 없이 완결되고,
 *  (4) 잠정→온라인 복구 재분기 시 착지 라우트도 교정되고 스플래시로 되돌아가지 않는다.
 *
 * TRIP-579 — 여기에 "최소 노출 floor" 를 얹는다: resolved 여도 마운트 후 SPLASH_MIN_VISIBLE_MS
 * 가 지나기 전에는 스플래시를 유지한다(캐시 토큰으로 즉시 resolve 돼도 첫 화면이 한 프레임은 보임).
 * floor 타이머는 순수 setTimeout 이라 fake timer + 동기 act 로 결정적으로 검증한다.
 *
 * 훅 자체(fetch·타임아웃·netinfo)는 useBootstrapGate.test 가 이미 덮으므로 여기선 훅을 목으로
 * 구동해 "게이트가 훅 상태를 어떻게 화면/라우트로 옮기는가"(배선)만 본다.
 * expo-router 의 Stack/Protected/Screen 은 라우터 컨텍스트 없이 관찰하려고 마커로 목킹한다.
 */

jest.mock('@/features/auth/model/useBootstrapGate', () => ({
  __esModule: true,
  BOOTSTRAP_TIMEOUT_MS: 3000,
  useBootstrapGate: jest.fn(),
}));

// expo-router Stack 계열을 관찰 가능한 마커로 대체(마커 목 본체는 별도 모듈 — 상단 주해 참조).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-router', () => require('@/test-support/expoRouterStackMock'));

const mockUseBootstrapGate = useBootstrapGate as jest.MockedFunction<
  typeof useBootstrapGate
>;

type GateState = ReturnType<typeof useBootstrapGate>;

function gate(overrides: Partial<GateState> = {}): GateState {
  return {
    phase: 'resolved',
    destination: 'HOME',
    isProvisional: false,
    ...overrides,
  };
}

// floor 타이머(setTimeout)를 제어하려면 가짜 타이머가 필요하다. 이 경로엔 실 fetch·TanStack
// Query 가 없어(훅이 목) 동기 advance 로 충분하다 — advance 콜백의 setState 를 렌더에 반영시키려
// act() 로 감싼다.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  mockUseBootstrapGate.mockReset();
  jest.useRealTimers();
});

describe('SplashGate — 로딩 분기 (AC-W-01)', () => {
  it('phase==="loading" 이면 홈으로 직행하지 않고 SplashScreen 을 보여준다', () => {
    mockUseBootstrapGate.mockReturnValue(
      gate({ phase: 'loading', destination: null })
    );

    render(<SplashGate />);

    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('gate-stack')).toBeNull();
  });

  it('resolved 이지만 destination 이 아직 null 이면 스플래시를 유지한다(방어)', () => {
    mockUseBootstrapGate.mockReturnValue(
      gate({ phase: 'resolved', destination: null })
    );

    render(<SplashGate />);

    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();
  });
});

describe('SplashGate — 목적지별 라우트 노출 (AC-W-02·03)', () => {
  it('resolved+HOME 이면 스플래시가 사라지고 가드 스택(HOME 라우트)이 마운트된다', () => {
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));

    render(<SplashGate />);
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });

    expect(screen.queryByTestId('shell-splash-root')).toBeNull();
    expect(screen.getByTestId('gate-stack')).toBeOnTheScreen();
    expect(screen.getByTestId('gate-route-(tabs)')).toBeOnTheScreen();
  });

  // D1 가드 매핑표 — 5개 목적지 각각 착지 라우트가 존재해 크래시 없이 마운트된다.
  it.each([
    ['FORCE_UPDATE', 'gate-route-force-update'],
    ['RECONSENT', 'gate-route-reconsent'],
    ['LOGIN', 'gate-route-(auth)'],
    ['ONBOARDING', 'gate-route-(onboarding)'],
    ['HOME', 'gate-route-(tabs)'],
  ] as const)(
    'destination=%s 이면 %s 라우트만 마운트된다',
    (destination, routeTestId) => {
      mockUseBootstrapGate.mockReturnValue(gate({ destination }));

      render(<SplashGate />);
      act(() => {
        jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
      });

      expect(screen.getByTestId(routeTestId)).toBeOnTheScreen();
      expect(screen.queryByTestId('shell-splash-root')).toBeNull();
    }
  );

  it('LOGIN 목적지는 (auth) 라우트만 노출하고 (tabs) 는 노출하지 않는다(one-hot 가드)', () => {
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'LOGIN' }));

    render(<SplashGate />);
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });

    expect(screen.getByTestId('gate-route-(auth)')).toBeOnTheScreen();
    expect(screen.queryByTestId('gate-route-(tabs)')).toBeNull();
  });
});

describe('SplashGate — 잠정→교정 재분기 (AC-W-06)', () => {
  it('타임아웃 잠정 LOGIN 후 온라인 복구로 HOME 이 되면 착지 라우트가 교정되고 스플래시로 되돌아가지 않는다', () => {
    mockUseBootstrapGate.mockReturnValue(
      gate({ destination: 'LOGIN', isProvisional: true })
    );

    const { rerender } = render(<SplashGate />);
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });
    expect(screen.getByTestId('gate-route-(auth)')).toBeOnTheScreen();

    // 온라인 복구로 훅이 서버 판정(HOME, 확정)을 산출한 상태를 모사.
    mockUseBootstrapGate.mockReturnValue(
      gate({ destination: 'HOME', isProvisional: false })
    );
    rerender(<SplashGate />);

    expect(screen.getByTestId('gate-route-(tabs)')).toBeOnTheScreen();
    expect(screen.queryByTestId('gate-route-(auth)')).toBeNull();
    expect(screen.queryByTestId('shell-splash-root')).toBeNull();
  });
});

describe('SplashGate — 최소 노출 floor (TRIP-579)', () => {
  it('SPLASH_MIN_VISIBLE_MS 는 900ms 다 (floor 하한 · 발명값 상수, export)', () => {
    expect(SPLASH_MIN_VISIBLE_MS).toBe(900);
  });

  it('floor 미경과 구간에서는 resolved(HOME)여도 스플래시를 유지하고 라우트를 마운트하지 않는다 (AC-1)', () => {
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));

    render(<SplashGate />);
    // 하한 직전(floor - 1ms)까지 흘려도 타이머는 아직 발화하지 않는다(off-by-one 짝의 아래쪽).
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS - 1);
    });

    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('gate-stack')).toBeNull();
  });

  it('floor 가 경과하면 스플래시가 사라지고 목적지 라우트가 마운트된다 (AC-2)', () => {
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));

    render(<SplashGate />);
    // 하한 도달(floor)에서 타이머가 발화한다(off-by-one 짝의 위쪽).
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });

    expect(screen.queryByTestId('shell-splash-root')).toBeNull();
    expect(screen.getByTestId('gate-stack')).toBeOnTheScreen();
    expect(screen.getByTestId('gate-route-(tabs)')).toBeOnTheScreen();
  });

  it('부트스트랩이 floor 이후에 resolved 되면 추가 지연 없이 즉시 라우팅한다 (하한 전용 · AC-3)', () => {
    mockUseBootstrapGate.mockReturnValue(
      gate({ phase: 'loading', destination: null })
    );

    const { rerender } = render(<SplashGate />);
    // floor 는 이미 경과시키되, 목적지는 아직 미결(느린 네트워크) → 스플래시 유지.
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });
    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();

    // floor 이후에 목적지가 확정된 상태를 모사(resolve 시점이 이미 floor 초과).
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));
    rerender(<SplashGate />);

    // 추가 advance 없이 즉시 라우팅 — floor 는 하한이지 resolve 기준 재대기가 아니다.
    expect(screen.getByTestId('gate-route-(tabs)')).toBeOnTheScreen();
    expect(screen.queryByTestId('shell-splash-root')).toBeNull();
  });

  it('floor 경과 후 목적지 교정(LOGIN→HOME)은 floor 를 재대기하지 않고 스플래시로 되돌아가지 않는다 (깃발 단조성 · AC-4)', () => {
    mockUseBootstrapGate.mockReturnValue(
      gate({ destination: 'LOGIN', isProvisional: true })
    );

    const { rerender } = render(<SplashGate />);
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });
    expect(screen.getByTestId('gate-route-(auth)')).toBeOnTheScreen();

    // 잠정 LOGIN → 온라인 복구로 HOME 확정(AC-W-06 교정). 추가 advance 없음.
    mockUseBootstrapGate.mockReturnValue(
      gate({ destination: 'HOME', isProvisional: false })
    );
    rerender(<SplashGate />);

    // floorElapsed 는 한 번 true 면 다시 false 로 안 돈다 — 교정이 스플래시를 되살리지 못한다.
    expect(screen.getByTestId('gate-route-(tabs)')).toBeOnTheScreen();
    expect(screen.queryByTestId('gate-route-(auth)')).toBeNull();
    expect(screen.queryByTestId('shell-splash-root')).toBeNull();
  });
});
