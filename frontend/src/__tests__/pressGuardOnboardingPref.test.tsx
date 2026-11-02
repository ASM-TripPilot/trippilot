import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { usePreferenceStore } from '@/features/edit-preferences';
import {
  publishGateDestination,
  resetGateDestination,
} from '@/features/auth/model/gateDestination';
import { notifyBootstrapReeval } from '@/shared/lib/bootstrapReeval';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { answerReduceMotionSynchronously } from '@/test-support/animatedProbe';
import { PrefStep1Page } from '@/pages/onboarding/onboarding-pref1';
import { PrefStep2Page } from '@/pages/onboarding/onboarding-pref2';
import { OnboardingTourPage } from '@/pages/onboarding/onboarding-tour';

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
 *
 * TRIP-1421: '완료'는 이제 온보딩 완료 요청을 보내고 그 성공 + 게이트 HOME 공개 뒤에 기능 안내(/onboarding-tour, TRIP-1595 — 홈은 거기서 연다)로 간다 →
 * 창 안의 탭은 완료 요청도 0회, 창 밖 재탭의 기능 안내 이동은 비동기로 센다(재평가 신호 목이 HOME 을 공개한다).
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

// TRIP-1421 — 온보딩 완료 호출만 바꾸고 나머지는 실물.
const mockCompleteOnboarding = jest.fn<Promise<void>, []>();
jest.mock('@/shared/api', () => ({
  __esModule: true,
  ...jest.requireActual('@/shared/api'),
  completeOnboarding: () => mockCompleteOnboarding(),
}));

// 모듈 싱글턴(연타 창·스토어·게이트 목적지)은 파일 최상위에서 리셋한다.
beforeEach(() => {
  resetPressGuard();
  // TRIP-1624 — "동작 줄이기" 답을 effect 안에서 동기로 받는다(비동기 답이 act 밖에서 상태를 바꾸는 경고 제거).
  answerReduceMotionSynchronously(false);
  usePreferenceStore.getState().reset();
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
  routerMock.back.mockClear();
  mockPutMutate.mockClear();
  mockCompleteOnboarding.mockReset();
  mockCompleteOnboarding.mockResolvedValue(undefined);
  resetGateDestination();
  publishGateDestination('ONBOARDING');
  mockNotifyReeval.mockReset();
  mockNotifyReeval.mockImplementation(() => {
    publishGateDestination('HOME');
  });
});

afterEach(() => {
  resetGateDestination();
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

  it('창 안의 완료는 저장·완료 요청·이동·재평가 신호가 모두 0회이고, 창이 지난 뒤 한 번 누르면 정확히 1회다', async () => {
    // 준비 — 취향을 하나 골라 둔다(TRIP-1500: 빈 스토어면 [완료]가 원래 PUT 을 안 보내 "창 안 0 → 창 밖 1" 대비가 사라진다).
    usePreferenceStore.getState().toggleStyle('rest');
    // 실행 ① — 1/2 '다음'(첫 탭).
    pressNextOnStep1();
    // 앵커 — 첫 탭은 제 할 일을 했다(2/2 로 push).
    expect(routerMock.push).toHaveBeenCalledWith('/(onboarding)/pref2');

    // 실행 ② — 같은 자리에 떨어진 두 번째 탭(2/2 '완료').
    render(<PrefStep2Page />);
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    // 단언 — 사용자가 누르지 않은 완료는 아무것도 하지 않는다.
    expect(mockPutMutate).toHaveBeenCalledTimes(0);
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(0);
    expect(routerMock.replace).toHaveBeenCalledTimes(0);
    expect(mockNotifyReeval).toHaveBeenCalledTimes(0);

    // 무회귀 — 창이 닫힌 뒤 사람이 다시 누르면 정상 동작한다(= 위 누름이 실제로 전달되는 요소였다).
    resetPressGuard();
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    await waitFor(() =>
      expect(routerMock.replace.mock.calls).toEqual([['/onboarding-tour']])
    );
    expect(mockPutMutate).toHaveBeenCalledTimes(1);
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
  });
});

/**
 * TRIP-1595 — 취향 2/2 '완료' 연타의 두 번째 탭이 기능 안내 1장의 '다음'을 누르지 않는다.
 *
 * 두 화면의 하단 전폭 버튼이 같은 자리라, 완료가 성공해 기능 안내가 뜨는 순간 사용자의 연타가 '다음'에 떨어지면
 * 1장을 한 번도 못 본 채 2장이 된다(위치→푸시 TRIP-1108 과 같은 사고). 완료는 응답을 기다리느라 첫 탭의 400ms 창이
 * 이미 끝난 뒤에 이동하므로, 막는 것은 `finishOnboarding` 이 `replace` 직전에 다시 여는 창과 투어 '다음'의 가드 둘뿐이다.
 *
 * 시계를 손으로 돌린다: 첫 탭 시각 T0 → 응답 대기에 1000ms(= 창 만료) → 이동 직후 50ms 에 둘째 탭.
 * ⚠️ 여기서 `resetPressGuard()` 를 부르지 않는다 — 부르면 사고가 사라져 red 가 안 난다(`pressGuardOnboardingPush` X3 선례).
 */
describe('AC1 부속 · 완료 연타의 둘째 탭은 기능 안내 다음을 누르지 않는다', () => {
  let now: number;
  let clock: jest.SpyInstance;
  beforeEach(() => {
    now = FROZEN_NOW;
    clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => clock.mockRestore());

  it('X1 이동 직후 창 안의 다음 탭은 무시되고, 창이 닫힌 뒤엔 2장으로 넘어간다', async () => {
    // 준비 — 취향 2/2 를 그리고 완료를 누른다(첫 탭, 창 T0 에 열림)
    const step2 = render(<PrefStep2Page />);
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));
    // 응답 대기가 길어 창이 이미 닫힌 시각 — 완료 이어달리기는 아직 안 돌았다(동기 구간)
    now = FROZEN_NOW + 1000;
    await waitFor(() =>
      expect(routerMock.replace.mock.calls).toEqual([['/onboarding-tour']])
    );

    // 실행 — 이동 50ms 뒤, 같은 자리에 떨어진 둘째 탭(기능 안내 '다음')
    now = FROZEN_NOW + 1050;
    step2.unmount();
    render(<OnboardingTourPage />);
    const progress = () => screen.getByTestId('onboarding-tour-progress'); // 갱신 뒤 다시 찾는다(낡은 노드 참조 방지)
    expect(progress()).toHaveAccessibilityValue({ now: 1 }); // 앵커 — 1장에서 시작했다
    fireEvent.press(screen.getByTestId('onboarding-tour-next'));

    // 단언 — 삼켜졌다: 여전히 1장
    expect(progress()).toHaveAccessibilityValue({ now: 1 });

    // 무회귀 — 창이 닫힌 뒤 사람이 누르면 넘어간다(= 위 누름이 전달되는 요소였다)
    now = FROZEN_NOW + 1500;
    fireEvent.press(screen.getByTestId('onboarding-tour-next'));
    expect(progress()).toHaveAccessibilityValue({ now: 2 });
  });

  // 취향 1/2 우상단 `나중에 설정하고 시작`은 투어 우상단 `건너뛰기`와 같은 자리다 — 연타의 둘째 탭이 투어를 한 번도 못 본 채 홈으로 보낸다.
  // 1/2 의 skipAll 은 guardPress 로 감싸지 않아(첫 탭 창이 없다) 막는 것은 `replace` 직전의 `openPressGuardWindow()` 와 투어 skip 의 guardPress 둘뿐이다.
  it('X2 1/2 일괄 탈출 직후 창 안의 투어 건너뛰기 탭은 무시되고, 창이 닫힌 뒤엔 홈으로 간다', async () => {
    // 준비 — 취향 1/2 를 그리고 우상단 일괄 탈출을 누른다(완료 이어달리기는 아직 안 돌았다)
    const step1 = render(<PrefStep1Page />);
    fireEvent.press(screen.getByTestId('onboarding-pref1-skip-top'));
    now = FROZEN_NOW + 1000;
    await waitFor(() =>
      expect(routerMock.replace.mock.calls).toEqual([['/onboarding-tour']])
    );

    // 실행 — 이동 50ms 뒤, 같은 자리에 떨어진 둘째 탭(투어 '건너뛰기')
    now = FROZEN_NOW + 1050;
    step1.unmount();
    render(<OnboardingTourPage />);
    expect(screen.getByTestId('onboarding-tour-skip')).toBeOnTheScreen(); // 앵커 — 투어 1장이 떴다
    fireEvent.press(screen.getByTestId('onboarding-tour-skip'));

    // 단언 — 삼켜졌다: 홈('/(tabs)')으로 가지 않았다
    expect(routerMock.replace.mock.calls).toEqual([['/onboarding-tour']]);

    // 무회귀 — 창이 닫힌 뒤 사람이 누르면 홈으로 간다(= 위 누름이 전달되는 요소였다)
    now = FROZEN_NOW + 1500;
    fireEvent.press(screen.getByTestId('onboarding-tour-skip'));
    expect(routerMock.replace.mock.calls).toEqual([
      ['/onboarding-tour'],
      ['/(tabs)'],
    ]);
  });
});
