import { fireEvent, render, screen } from '@testing-library/react-native';

import { openPressGuardWindow, resetPressGuard } from '@/shared/lib/pressGuard';

import { OnboardingTourPage } from './OnboardingTourPage';

/**
 * TRIP-1595 AC3 — 기능 안내 컨테이너 배선: `건너뛰기`(1~5장)·`시작하기`(6장) → 홈(`/`)으로 replace.
 *
 * 무엇을 보장하나:
 *  - 나가는 버튼은 `router.replace('/(tabs)')`(TRIP-1597 — `'/'` 는 잠긴 온보딩 index 로 풀린다) 정확히 1회이고 `push`·`back`은 0회다(스택에 투어를 남기지 않는다).
 *  - 연타해도 1회다(`guardPress`). 이동 직전에 `openPressGuardWindow()`를 **컨테이너가 직접** 연다 —
 *    홈 탭 바가 같은 자리에 올라오는 순간의 둘째 탭이 홈 탭을 누르지 않게 한다.
 *  - 렌더만으로는 어디로도 가지 않는다.
 *
 * 페이저·진행 점·무대 같은 화면 쪽 계약은 `OnboardingTourView.test.tsx`가 본다. 이 파일은 MSW가 없어 node 버킷이다
 * (`PushPage.test` 선례). 진짜 라우터에서 스택이 한 장만 남는 모양은 `SplashGate.integration.test.tsx`가 본다.
 *
 * 3동작 뼈대: 준비(렌더) → 실행(누르기) → 단언(replace 인자·횟수·호출 순서).
 */

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

// 컨테이너가 **직접** 부른 openPressGuardWindow 만 센다 — guardPress 는 같은 모듈의 지역 참조를 불러 이 목을 거치지 않는다(02a ★8).
jest.mock('@/shared/lib/pressGuard', () => {
  const actual = jest.requireActual('@/shared/lib/pressGuard');
  return {
    ...actual,
    openPressGuardWindow: jest.fn(actual.openPressGuardWindow),
  };
});
const mockOpenWindow = openPressGuardWindow as jest.Mock;

/** 가드 판정용으로 멈춰 둘 시각(값은 의미 없다 — 흐르지 않는 것이 요점). */
const FROZEN_NOW = 1_790_000_000_000;

// 모듈 싱글턴(연타 창·호출 기록)은 파일 최상위에서 리셋한다.
beforeEach(() => {
  resetPressGuard();
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
  routerMock.back.mockClear();
  mockOpenWindow.mockClear();
});

/** 6장까지 `다음`을 누른다 — 누름마다 앞 가드 창을 닫는다(02a ★6). */
function goToLastPage(): void {
  for (let i = 0; i < 5; i += 1) {
    resetPressGuard();
    fireEvent.press(screen.getByTestId('onboarding-tour-next'));
  }
  expect(screen.getByTestId('onboarding-tour-start')).toBeOnTheScreen();
}

describe('AC3 · 건너뛰기·시작하기 → 홈으로 replace', () => {
  it('G1 1장에서 건너뛰기를 누르면 홈으로 replace 1회, push·back 0회이고 렌더만으로는 이동하지 않는다', () => {
    // 준비 — 앵커: 렌더만으로는 어디로도 가지 않는다
    render(<OnboardingTourPage />);
    expect(routerMock.replace).not.toHaveBeenCalled();

    // 실행
    fireEvent.press(screen.getByTestId('onboarding-tour-skip'));

    // 단언
    expect(routerMock.replace.mock.calls).toEqual([['/(tabs)']]);
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(routerMock.back).not.toHaveBeenCalled();
  });

  it('G2 6장까지 넘겨 시작하기를 누르면 홈으로 replace 1회이고, 넘기는 동안은 이동하지 않는다', () => {
    // 준비·실행 1 — 6장까지
    render(<OnboardingTourPage />);
    goToLastPage();

    // 단언 1 — 장을 넘기는 것만으로는 이동 0
    expect(routerMock.replace).not.toHaveBeenCalled();

    // 실행 2
    resetPressGuard();
    fireEvent.press(screen.getByTestId('onboarding-tour-start'));

    // 단언 2
    expect(routerMock.replace.mock.calls).toEqual([['/(tabs)']]);
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(routerMock.back).not.toHaveBeenCalled();
  });

  it('G3 건너뛰기를 연타하면 replace 는 1회이고, 창이 닫힌 뒤엔 다시 먹는다', () => {
    // 준비 — 시계를 멈춰 두 번째 누름이 창 안에 떨어지게 한다
    const clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
    try {
      render(<OnboardingTourPage />);

      // 실행 — 같은 자리에 연달아 두 번
      fireEvent.press(screen.getByTestId('onboarding-tour-skip'));
      fireEvent.press(screen.getByTestId('onboarding-tour-skip'));

      // 단언 1 — 한 번뿐
      expect(routerMock.replace).toHaveBeenCalledTimes(1);

      // 무회귀 — 창이 닫힌 뒤 사람이 다시 누르면 전달된다(= 위 두 번째 누름이 전달되는 요소였다)
      resetPressGuard();
      fireEvent.press(screen.getByTestId('onboarding-tour-skip'));
      expect(routerMock.replace).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('G4 이동 직전에 컨테이너가 직접 연타 가드 창을 연다(건너뛰기·시작하기 모두)', () => {
    // 준비 — 건너뛰기 쪽
    const first = render(<OnboardingTourPage />);
    expect(mockOpenWindow).not.toHaveBeenCalled();

    // 실행 1
    fireEvent.press(screen.getByTestId('onboarding-tour-skip'));

    // 단언 1 — 창을 열고 나서 replace (호출 순서 번호가 작을수록 먼저)
    expect(mockOpenWindow).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(mockOpenWindow.mock.invocationCallOrder[0]).toBeLessThan(
      routerMock.replace.mock.invocationCallOrder[0]
    );

    // 준비·실행 2 — 시작하기 쪽
    first.unmount();
    mockOpenWindow.mockClear();
    routerMock.replace.mockClear();
    render(<OnboardingTourPage />);
    goToLastPage();
    resetPressGuard();
    fireEvent.press(screen.getByTestId('onboarding-tour-start'));

    // 단언 2
    expect(mockOpenWindow).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(mockOpenWindow.mock.invocationCallOrder[0]).toBeLessThan(
      routerMock.replace.mock.invocationCallOrder[0]
    );
  });
});
