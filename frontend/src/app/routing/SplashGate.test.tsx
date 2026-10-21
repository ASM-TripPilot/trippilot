import type { ReactTestInstance } from 'react-test-renderer';
import { act, render, screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';

import { useBootstrapGate } from '@/features/auth';
import {
  promptAndRegisterPush,
  registerPushIfGranted,
  requestPushPermission,
} from '@/shared/push';

import {
  PUSH_REGISTER_DELAY_MS,
  SplashGate,
  SPLASH_MIN_VISIBLE_MS,
} from './SplashGate';

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
 *
 * TRIP-1350 — 옛 `SplashGate.push`(푸시 재등록)·`SplashGate.planbModal`(투명 모달 선언) 두 파일을 합쳤다.
 * 세 파일이 같은 목 4벌·`gate()` 팩토리를 복사해 쓰고 있었다.
 */

jest.mock('@/features/auth/model/useBootstrapGate', () => ({
  __esModule: true,
  BOOTSTRAP_TIMEOUT_MS: 3000,
  useBootstrapGate: jest.fn(),
}));

// 계정 경계 정리(TRIP-1077)는 SplashGate.accountBoundary.test 가 본다 — 여기선 Provider·router 목이 없어 끈다.
jest.mock('@/app/model/useAccountBoundaryReset', () => ({
  useAccountBoundaryReset: jest.fn(),
}));
// 푸시 탭 라우팅(상황 감지 FE-A)은 usePushRouting.test·SplashGate.integration.test 가 본다 — 같은 이유로 끈다.
jest.mock('@/app/model/usePushRouting', () => ({
  usePushRouting: jest.fn(),
}));

// expo-router Stack 계열을 관찰 가능한 마커로 대체(마커 목 본체는 별도 모듈 — 상단 주해 참조).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-router', () => require('@/test-support/expoRouterStackMock'));

// 하한 기준점(JS 모듈 로드 시각)은 모듈 최상위 값이라 테스트가 바꿀 수 없다 — 목으로 갈아 beforeEach 에서 "지금"으로 맞춘다
// (그래야 마운트 시점 경과 0 = 옛 동작과 같다). 경과를 흉내 내는 테스트는 mockBootAt 을 과거로 둔다(TRIP-1362).
let mockBootAt = 0;
jest.mock('./bootClock', () => ({
  get BOOT_MODULE_LOADED_AT() {
    return mockBootAt;
  },
}));

// 배럴을 통째로 갈지 않는다 — 실물을 먼저 펼쳐야 재수출이 늘어도(수신 입구 등) 형제 export 가 undefined 가 안 된다.
jest.mock('@/shared/push', () => ({
  ...jest.requireActual('@/shared/push'),
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

// floor 타이머(setTimeout)를 제어하려면 가짜 타이머가 필요하다. 이 경로엔 실 fetch·TanStack
// Query 가 없어(훅이 목) 동기 advance 로 충분하다 — advance 콜백의 setState 를 렌더에 반영시키려
// act() 로 감싼다.
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockBootAt = Date.now();
});

function passFloor(): void {
  act(() => {
    jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
  });
}

// 푸시 재등록은 HOME 진입 뒤 PUSH_REGISTER_DELAY_MS 만큼 미룬다(TRIP-1362) — 그 시간을 흘려야 루틴이 불린다.
function passPushDelay(): void {
  act(() => {
    jest.advanceTimersByTime(PUSH_REGISTER_DELAY_MS);
    // InteractionManager.runAfterInteractions 는 큐를 한 틱 뒤에 비운다.
    jest.runOnlyPendingTimers();
  });
}

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
  it('SPLASH_MIN_VISIBLE_MS 는 1300ms 다 (floor 하한 · 발명값 상수, export)', () => {
    expect(SPLASH_MIN_VISIBLE_MS).toBe(1300);
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

  it('하한 기준점은 마운트가 아니라 JS 모듈 로드 시각이다 — 로드 후 400ms 가 지났으면 마운트 뒤 500ms 에 풀린다 (TRIP-1362)', () => {
    mockBootAt = Date.now() - 400;
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));

    render(<SplashGate />);
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS - 400 - 1);
    });
    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('gate-route-(tabs)')).toBeOnTheScreen();
  });

  it('로드 후 이미 1300ms 를 넘겼으면 하한은 마운트 즉시 풀리되 0 으로 내려가진 않는다(한 프레임은 스플래시가 보인다) (TRIP-1362)', () => {
    mockBootAt = Date.now() - 5000;
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));

    render(<SplashGate />);
    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();

    act(() => {
      jest.advanceTimersByTime(0);
    });
    expect(screen.getByTestId('gate-route-(tabs)')).toBeOnTheScreen();
  });

  it('시계가 뒤로 가 경과가 음수여도 하한(1300ms)보다 오래 기다리지 않는다 (TRIP-1362)', () => {
    mockBootAt = Date.now() + 60_000;
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));

    render(<SplashGate />);
    passFloor();

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
});

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
 * HOME 재진입은 훅 목 반환값을 바꾼 뒤 `rerender` 로 흉내 낸다 — 루트 셸은 실제 앱에서도 언마운트되지 않는다.
 */

describe('TRIP-835 AC-4 · HOME 진입 → 조용한 재등록', () => {
  it('H1 HOME 이면 등록 루틴 1회, 같은 HOME 으로 다시 그려도 1회 — 요청 루틴은 0회', () => {
    // 준비
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));

    // 실행
    const view = render(<SplashGate />);
    passFloor();
    view.rerender(<SplashGate />);

    // 단언 — 홈 첫 요청과 경쟁하지 않게 지연 전에는 0회, 지연 뒤 1회(TRIP-1362)
    expect(mockRegisterIfGranted).not.toHaveBeenCalled();
    passPushDelay();
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
    passPushDelay();

    // 단언
    expect(mockRegisterIfGranted).toHaveBeenCalledTimes(1);
  });

  it('H4b 지연 중에 HOME 을 떠나면(로그아웃) 예약된 등록은 취소된다 — 0회 (TRIP-1362)', () => {
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));
    const view = render(<SplashGate />);
    passFloor();

    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'LOGIN' }));
    view.rerender(<SplashGate />);
    passPushDelay();

    expect(mockRegisterIfGranted).not.toHaveBeenCalled();
  });

  it('H5 로그아웃 뒤 다시 로그인하면(HOME → LOGIN → HOME) 다시 부른다 — 총 2회', () => {
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));
    const view = render(<SplashGate />);
    passFloor();

    passPushDelay();

    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'LOGIN' }));
    view.rerender(<SplashGate />);
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));
    view.rerender(<SplashGate />);
    passPushDelay();

    expect(mockRegisterIfGranted).toHaveBeenCalledTimes(2);
  });
});

function insideProtected(node: ReactTestInstance): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === Stack.Protected) return true;
    current = current.parent;
  }
  return false;
}

/**
 * TRIP-750 · AC-9 · D1 · Q7 — 루트 Stack 이 i04 재계획 요청 라우트를 `transparentModal` 로 선언한다.
 * TRIP-1322 · BR-U8-01 · DEC-U8-13 — ✦ 도우미 시트 라우트(`assistant/index`)도 같다: `(tabs)` 밖이라 탭바가 가려지고
 * 뒤 화면은 딤 아래 남는다.
 *
 * 무엇을 보장하나: 두 선언이 목적지와 무관하게 하나씩 있고(`Stack.Protected` 밖), `options.presentation` 이
 * `transparentModal` 이다 — 허브 위에 겹쳐 뜨는 라우트 단위 속성.
 * jest 가 잠그는 것은 **선언까지**다(02a ★15). 스택 목은 options 를 그리지 않으므로 목 컴포넌트가 받은
 * props 를 읽는다. 실제로 허브가 비쳐 보이는지·딤·모달 안 제스처는 6-b 실기.
 */
describe.each([
  ['🔴 P1 · planb 요청 라우트 (TRIP-750 AC-9)', 'trips/[tripId]/planb/index'],
  ['🔴 도우미 시트 라우트 (TRIP-1322)', 'assistant/index'],
])('%s transparentModal 선언', (_label, routeName) => {
  it.each(['HOME', 'LOGIN'] as const)(
    '목적지 %s 에서도 가드 밖에 transparentModal 선언이 하나 있다',
    (destination) => {
      mockUseBootstrapGate.mockReturnValue(gate({ destination }));

      render(<SplashGate />);
      passFloor();

      const declared = screen
        .UNSAFE_getAllByType(Stack.Screen)
        .filter((node) => node.props.name === routeName);
      expect(declared).toHaveLength(1);
      expect(declared[0].props.options?.presentation).toBe('transparentModal');
      expect(insideProtected(declared[0])).toBe(false);
    }
  );
});

/**
 * 허브(`trips/[tripId]/live/index`)로 들어갈 때만 전환이 `none`(즉시 교체)이다 — 허브 바가 홈 탭 바와 같은 5칸으로 시작해 모프를 혼자 재생하려면
 * 아래 `(tabs)`(탭 바 포함)가 밀리거나 비치지 않고 허브가 즉시 그 자리를 대체해야 한다(크로스페이드는 탭 바가 비쳐 이중으로 보인다). 허브로 들어가는 모든 길이
 * 이 한 선언에 걸린다. 선언 위치가 `SplashGate` 인 이유: planb·assistant 선례, 라우트 파일 안에서 하면 `liveHubRoute.test` 의 expo-router 목이 깨진다.
 * jest 가 잠그는 것은 선언까지다(스택 목은 options 를 그리지 않는다) — 실제 전환·스와이프 뒤로·탭 바와의 겹침은 6-b.
 */
describe('SplashGate · 허브 라우트 none 전환 선언', () => {
  const HUB_ROUTE = 'trips/[tripId]/live/index';

  it.each(['HOME', 'LOGIN'] as const)(
    '목적지 %s 에서도 가드 밖에 허브 라우트 선언이 하나 있고 animation 이 none 이다',
    (destination) => {
      mockUseBootstrapGate.mockReturnValue(gate({ destination }));

      render(<SplashGate />);
      passFloor();

      const declared = screen
        .UNSAFE_getAllByType(Stack.Screen)
        .filter((node) => node.props.name === HUB_ROUTE);
      expect(declared).toHaveLength(1);
      expect(declared[0].props.options?.animation).toBe('none');
      expect(insideProtected(declared[0])).toBe(false);
    }
  );

  it('허브 하나만 none 이다 — 다른 선언·루트 screenOptions 에는 animation 이 없고 planb·assistant 는 그대로 transparentModal 이다', () => {
    mockUseBootstrapGate.mockReturnValue(gate({ destination: 'HOME' }));

    render(<SplashGate />);
    passFloor();

    const others = screen
      .UNSAFE_getAllByType(Stack.Screen)
      .filter((node) => node.props.name !== HUB_ROUTE);
    expect(others.length).toBeGreaterThanOrEqual(3); // 짝 앵커 — 빈 목록이라 공허하게 통과하지 않게
    others.forEach((node) =>
      expect(node.props.options?.animation).toBeUndefined()
    );
    for (const routeName of ['trips/[tripId]/planb/index', 'assistant/index'])
      expect(
        others.find((node) => node.props.name === routeName)?.props.options
          ?.presentation
      ).toBe('transparentModal');
    expect(
      screen.UNSAFE_getByType(Stack).props.screenOptions.animation
    ).toBeUndefined();
  });
});
