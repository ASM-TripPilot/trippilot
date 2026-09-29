import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { LocationPage } from '@/pages/onboarding-location';
import { PushPage } from '@/pages/onboarding-push';
import { resetPressGuard } from '@/shared/press/pressGuard';
import { promptAndRegisterPush } from '@/shared/push';

/**
 * TRIP-1108 AC-5b · R6 — 위치 카드에서 누른 두 번째 탭이 새로 뜬 푸시 카드를 **대신 누르지 않는다**.
 *
 * 두 카드는 하단 버튼 두 개가 같은 자리에 있다. 위치 카드에서 빠르게 두 번 누르면 두 번째 탭이 새로 뜬
 * 푸시 카드의 같은 자리 버튼에 떨어져, 사용자는 카드를 보지도 못하고 지나간다(취향 1/2→2/2 실측 사고와
 * 같은 모양 — `pressGuardOnboardingPref.test.tsx`). jest 는 전환 애니메이션을 못 보므로 **두 페이지를
 * 차례로 그리고 이어 누른다** — 두 화면을 잇는 것은 모듈 하나에 든 400ms 창뿐이다.
 *
 * 같은 자리끼리 잇는다: 위치 `나중에 하기`(아래) → 푸시 `나중에 하기`(아래),
 * 위치 거부 프레임 `계속`(위) → 푸시 `계속`(위).
 *
 * "창 밖"은 `resetPressGuard()` 로 만든다(= 400ms 이상 흐른 것과 같다).
 */

const mockRequestForeground = jest.fn();
const mockGetForeground = jest.fn();
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForeground(...args),
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
}));

jest.mock('expo-linking', () => ({
  openSettings: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
  getPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => {
  const replace = jest.fn();
  const push = jest.fn();
  const back = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ replace, push, back }),
    router: { replace, push, back },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  replace: jest.Mock;
  push: jest.Mock;
  back: jest.Mock;
};

const mockPrompt = promptAndRegisterPush as jest.Mock;
const PUSH_ROUTE = '/(onboarding)/push';
const PREF1_ROUTE = '/(onboarding)/pref1';
const FROZEN_NOW = 1_790_000_000_000;

// 창은 모듈 싱글턴이다 — 파일 최상위에서 앞뒤로 닫는다.
beforeEach(() => {
  resetPressGuard();
  jest.clearAllMocks();
  mockPrompt.mockImplementation(() => Promise.resolve());
  mockGetForeground.mockResolvedValue({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
  });
});
afterEach(() => resetPressGuard());

describe('🔴 TRIP-1108 AC-5b · 위치 "나중에 하기" → 창 안의 푸시 "나중에 하기"는 무시된다', () => {
  let clock: jest.SpyInstance;
  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  });
  afterEach(() => clock.mockRestore());

  it('X1 두 번째 탭은 푸시 카드를 넘기지 못하고, 창이 지난 뒤 한 번 누르면 정상으로 넘어간다', () => {
    // 실행 ① — 위치 카드 "나중에 하기"(첫 탭)
    const location = render(<LocationPage />);
    fireEvent.press(screen.getByTestId('onboarding-location-later'));
    // 앵커 — 첫 탭은 제 할 일을 했다(푸시 카드로 replace)
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenLastCalledWith(PUSH_ROUTE);
    location.unmount();

    // 실행 ② — 같은 자리에 떨어진 두 번째 탭(푸시 카드 "나중에 하기")
    render(<PushPage />);
    fireEvent.press(screen.getByTestId('onboarding-push-later'));

    // 단언 — 사용자가 누르지 않은 넘김은 아무 일도 하지 않는다
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).not.toHaveBeenCalledWith(PREF1_ROUTE);
    expect(mockPrompt).toHaveBeenCalledTimes(0);

    // 무회귀 — 창이 닫힌 뒤 사람이 다시 누르면 넘어간다(= 위 누름이 살아 있는 버튼에 전달됐었다)
    resetPressGuard();
    fireEvent.press(screen.getByTestId('onboarding-push-later'));
    expect(routerMock.replace).toHaveBeenCalledTimes(2);
    expect(routerMock.replace).toHaveBeenLastCalledWith(PREF1_ROUTE);
  });
});

describe('🔴 TRIP-1108 AC-5b · 위치 거부 프레임 "계속" → 창 안의 푸시 "계속"은 무시된다', () => {
  it('X2 두 번째 탭은 푸시 권한 루틴을 부르지 못하고, 창이 지난 뒤 한 번 누르면 루틴 1회 + 취향 1/2', async () => {
    // 준비 — 위치 "계속" → OS 가 거부로 답해 거부 프레임까지 간다
    mockRequestForeground.mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: false,
    });
    const location = render(<LocationPage />);
    fireEvent.press(screen.getByTestId('onboarding-location-allow'));
    await waitFor(() =>
      expect(
        screen.getByTestId('onboarding-location-continue')
      ).toBeOnTheScreen()
    );
    // OS 창에 답하는 사람 시간(400ms 이상)이 흘렀다 — 위치 "계속"을 감쌌든 아니든 창 밖이다.
    resetPressGuard();
    // 비동기 대기는 끝났다 — 이제 시계를 멈춘다(waitFor 앞에서 멈추면 실패 시 무한 대기).
    const clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);

    try {
      // 실행 ① — 거부 프레임 "계속"(첫 탭)
      fireEvent.press(screen.getByTestId('onboarding-location-continue'));
      expect(routerMock.replace).toHaveBeenCalledTimes(1);
      expect(routerMock.replace).toHaveBeenLastCalledWith(PUSH_ROUTE);
      location.unmount();

      // 실행 ② — 같은 자리(위 칸)에 떨어진 두 번째 탭(푸시 "계속")
      render(<PushPage />);
      fireEvent.press(screen.getByTestId('onboarding-push-allow'));

      // 단언 — 사용자가 누르지 않은 "계속"은 OS 창을 띄우지 않는다
      expect(mockPrompt).toHaveBeenCalledTimes(0);
      expect(routerMock.replace).toHaveBeenCalledTimes(1);

      // 무회귀 — 창 밖에서 누르면 루틴 1회 + 취향 1/2
      resetPressGuard();
      fireEvent.press(screen.getByTestId('onboarding-push-allow'));
      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expect(routerMock.replace).toHaveBeenCalledTimes(2);
      expect(routerMock.replace).toHaveBeenLastCalledWith(PREF1_ROUTE);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('🔴 TRIP-1108 5-b 경고-1 · 위치 권한이 이미 허용됨 — 위치 "계속" → 창 안의 푸시 "계속"은 무시된다', () => {
  // OS 창이 안 뜨는 경우다(같은 기기의 두 번째 계정·재진입 등) — 사람이 답하는 시간이 없으니 두 탭 사이가
  // 400ms 창 안이다. 그래서 X2 와 달리 **처음부터** 시계를 멈추고, 첫 탭 뒤 resetPressGuard() 를 부르지 않는다.
  // 고치는 쪽은 둘 다 통과한다: (a) granted 분기에서 이동 직전 openPressGuardWindow() / (b) 위치 "계속" 을 guardPress 로 감싸기.
  let clock: jest.SpyInstance;
  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  });
  afterEach(() => clock.mockRestore());

  it('X3 두 번째 탭은 푸시 권한 루틴을 부르지 못하고 취향 1/2 로 넘기지도 못하며, 창이 지난 뒤 한 번 누르면 정상이다', async () => {
    // 준비 — OS 요청이 창 없이 곧장 granted 로 답한다
    mockRequestForeground.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
    });

    // 실행 ① — 위치 "계속"(첫 탭) → 응답(마이크로태스크)을 흘린다. waitFor 는 멈춘 시계 아래 쓰지 않는다.
    const location = render(<LocationPage />);
    fireEvent.press(screen.getByTestId('onboarding-location-allow'));
    await act(async () => {});
    // 앵커 — 첫 탭은 제 할 일을 했다(푸시 카드로 replace)
    expect(mockRequestForeground).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenLastCalledWith(PUSH_ROUTE);
    location.unmount();

    // 실행 ② — 같은 자리(위 칸)에 떨어진 두 번째 탭(푸시 "계속")
    render(<PushPage />);
    fireEvent.press(screen.getByTestId('onboarding-push-allow'));

    // 단언 — 사용자가 누르지 않은 "계속"은 OS 창을 띄우지도, 카드를 넘기지도 않는다
    expect(mockPrompt).toHaveBeenCalledTimes(0);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).not.toHaveBeenCalledWith(PREF1_ROUTE);

    // 무회귀 — 창 밖에서 누르면 루틴 1회 + 취향 1/2(= 위 누름이 살아 있는 버튼에 전달됐었다)
    resetPressGuard();
    fireEvent.press(screen.getByTestId('onboarding-push-allow'));
    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(2);
    expect(routerMock.replace).toHaveBeenLastCalledWith(PREF1_ROUTE);
  });
});
