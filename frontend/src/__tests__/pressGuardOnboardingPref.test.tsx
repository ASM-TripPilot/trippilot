import { fireEvent, render, screen } from '@testing-library/react-native';

import { usePreferenceStore } from '@/features/edit-preferences';
import { notifyBootstrapReeval } from '@/shared/lib/bootstrapReeval';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { PrefStep1Page } from '@/pages/onboarding/onboarding-pref1';
import { PrefStep2Page } from '@/pages/onboarding/onboarding-pref2';

/**
 * TRIP-1013 #004 — 취향 1/2 '다음' 연타의 두 번째 탭이 2/2 '완료'를 누르지 않는다.
 *
 * 실기에서는 1/2 '다음'이 2/2 를 push 하는 동안 두 번째 탭이 같은 자리(하단 전폭 버튼)의
 * '완료'에 떨어져, 사용자가 2/2 를 한 번도 못 본 채 온보딩이 끝났다(QA DB: budget·companion 빈값).
 * jest 는 전환 애니메이션을 못 보므로 **두 페이지를 차례로 그리고 이어 누른다** — 두 화면을 잇는
 * 것은 모듈 하나에 든 400ms 창뿐이다.
 *
 * "창 밖"은 `resetPressGuard()`로 만든다(=400ms 이상 흐른 것과 같다 — 400ms 경계 자체는
 * `shared/lib/pressGuard.test.ts` 가 가짜 타이머로 잠근다).
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

jest.mock('@/shared/lib/bootstrapReeval', () => ({
  notifyBootstrapReeval: jest.fn(),
  subscribeBootstrapReeval: jest.fn(() => () => {}),
}));
const mockNotifyReeval = notifyBootstrapReeval as jest.MockedFunction<
  typeof notifyBootstrapReeval
>;

const mockPutMutate = jest.fn();
jest.mock('@/shared/api/generated/preferences/preferences', () => ({
  usePutMePreferences: () => ({ mutate: mockPutMutate }),
}));

beforeEach(() => {
  resetPressGuard();
  usePreferenceStore.getState().reset();
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
  routerMock.back.mockClear();
  mockNotifyReeval.mockClear();
  mockPutMutate.mockClear();
});

/** 1/2 를 그리고 '다음'을 누른 뒤 1/2 를 치운다(=2/2 로 넘어간 순간). */
function pressNextOnStep1(): void {
  const step1 = render(<PrefStep1Page />);
  fireEvent.press(screen.getByTestId('onboarding-pref1-next'));
  step1.unmount();
}

/** 가드 판정용으로 멈춰 둘 시각(값 자체는 의미 없다 — 흐르지 않는 것이 요점). */
const FROZEN_NOW = 1_790_000_000_000;

describe('AC-004 · 1/2 다음 → 창 안의 2/2 완료는 무시된다', () => {
  // 시계를 멈춘다 — 화면을 그리고 응답을 기다리는 동안 실제 시간이 흘러 "창 안"이 400ms 를 넘기면
  // 판정이 흔들린다(02a ★2). "창 밖"은 resetPressGuard() 로만 만든다.
  let clock: jest.SpyInstance;
  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  });
  afterEach(() => clock.mockRestore());

  it('창 안의 완료는 저장·홈 이동·재평가 신호가 모두 0회이고, 창이 지난 뒤 한 번 누르면 정확히 1회다', () => {
    // 준비·실행 ① — 1/2 '다음'(첫 탭).
    pressNextOnStep1();
    // 앵커 — 첫 탭은 제 할 일을 했다(2/2 로 push).
    expect(routerMock.push).toHaveBeenCalledWith('/(onboarding)/pref2');

    // 실행 ② — 같은 자리에 떨어진 두 번째 탭(2/2 '완료').
    render(<PrefStep2Page />);
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    // 단언 — 사용자가 누르지 않은 완료는 아무것도 하지 않는다.
    expect(mockPutMutate).toHaveBeenCalledTimes(0);
    expect(routerMock.replace).toHaveBeenCalledTimes(0);
    expect(mockNotifyReeval).toHaveBeenCalledTimes(0);

    // 무회귀 — 창이 닫힌 뒤 사람이 다시 누르면 정상 동작한다(= 위 누름이 실제로 전달되는 요소였다).
    resetPressGuard();
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    expect(mockPutMutate).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledWith('/');
  });
});
