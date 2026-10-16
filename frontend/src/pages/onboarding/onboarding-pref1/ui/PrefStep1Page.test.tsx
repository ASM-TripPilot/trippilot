import {
  act,
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
import { PrefStep1Page } from './PrefStep1Page';

/**
 * AC3 · AC4 — 취향 1/2 배선(스토어 ↔ 화면 ↔ 라우터).
 *
 * 무엇을 보장하나: 카드 탭이 실제로 스토어를 바꾸고 그 결과가 화면에 다시 반영되며(왕복),
 * '다음'은 0개 선택에도 2/2로 push하고, 상·하단 '나중에 설정하고 시작'은 홈으로
 * replace하면서 스토어를 건드리지 않는다(미선택 축이 []로 새지 않는다 — AC4).
 *
 * expo-router는 인라인 factory 목(§7-10 — 컨테이너 useRouter는 이 방식, 레이아웃/Redirect
 * 관찰과는 다른 목 종류를 쓴다), 스토어는 **실제** usePreferenceStore를 쓰고 매 테스트
 * 전 reset()한다(모듈 싱글턴이 테스트 간 상태를 새게 두지 않기 위해 — §7-6).
 *
 * TRIP-1421: 상단 '나중에 설정하고 시작'은 **온보딩 완료(`POST /onboarding/complete`)가 성공하고 루트 게이트가
 * HOME 을 연 뒤에만** 홈으로 간다. 실패하면 화면에 남아 오류 한 줄을 보이고, 대기 중 재탭은 완료를 한 번만 보낸다.
 * 게이트 흉내: 재평가 신호 목이 불리면 `publishGateDestination('HOME')`(진짜 부트스트랩 재평가가 하는 일).
 *
 * 3동작: 준비(reset+렌더) → 실행(탭) → 단언(화면 반영/스토어 값/라우터 호출).
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

// TRIP-353 — 온보딩 완료 재평가 신호를 목킹해, 일괄 탈출이 신호를 발화하는지 spy 로 관찰한다.
// 취향 1/2 의 '나중에 설정하고 시작'도 완료 탈출구라 홈 진입해야 한다(ticket AC-A · US-ONB-11).
jest.mock('@/shared/lib/bootstrapReeval', () => ({
  notifyBootstrapReeval: jest.fn(),
  subscribeBootstrapReeval: jest.fn(() => () => {}),
}));
const mockNotifyReeval = notifyBootstrapReeval as jest.MockedFunction<
  typeof notifyBootstrapReeval
>;

// TRIP-1421 — 1/2 에는 PUT 이 없어야 한다(skip 은 고른 값을 서버로 안 보낸다) — 부르면 잡히게 목을 둔다.
const mockPutMutate = jest.fn();
jest.mock('@/shared/api/generated/preferences/preferences', () => ({
  usePutMePreferences: () => ({ mutate: mockPutMutate }),
}));

// TRIP-1421 — 온보딩 완료 호출만 바꾸고 나머지는 실물(게이트·생성 훅이 로드 때 쓰는 값 보존).
const mockCompleteOnboarding = jest.fn<Promise<void>, []>();
jest.mock('@/shared/api', () => ({
  __esModule: true,
  ...jest.requireActual('@/shared/api'),
  completeOnboarding: () => mockCompleteOnboarding(),
}));

const COMPLETE_ERROR = '시작하지 못했어요. 다시 시도해 주세요';

// 모듈 싱글턴(스토어·연타 창·게이트 목적지)은 파일 최상위에서 리셋한다.
beforeEach(() => {
  resetPressGuard(); // TRIP-1013 — 연타 가드 창(모듈 전역)이 앞 테스트에서 새지 않게 닫는다.
  // 준비(공통) — 모듈 싱글턴 스토어를 매 테스트 전 되돌린다(§7-6).
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

describe('PrefStep1Page — 탭↔스토어 왕복 (AC3 · 5-1)', () => {
  it('카드를 탭하면 화면에 선택 표시가 되고 스토어 값도 함께 바뀐다', () => {
    // 준비 — 렌더(스토어는 이미 reset 완료).
    render(<PrefStep1Page />);

    // 실행 — 'rest' 카드를 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref1-style-rest'));

    // 단언 — 화면이 재렌더되어 rest가 selected로 보인다(탭→스토어→재렌더 배선 증명).
    expect(screen.getByTestId('onboarding-pref1-style-rest')).toBeSelected();
    // 단언 — 스토어 상태도 함께 바뀌었다.
    expect(usePreferenceStore.getState().styles).toEqual(['rest']);
  });
});

describe('PrefStep1Page — 다음 내비게이션 (AC3 · AC-nav-1 · 5-2)', () => {
  it('0개 선택에도 다음을 탭하면 2/2로 push한다', () => {
    // 준비 — 아무 것도 고르지 않은 채 렌더.
    render(<PrefStep1Page />);

    // 실행 — CTA 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref1-next'));

    // 단언 — push('/(onboarding)/pref2') — replace가 아니라 push(2/2의 back()이 1/2로
    // 돌아와야 하므로 스택을 쌓는다 — §7-16).
    expect(routerMock.push).toHaveBeenCalledWith('/(onboarding)/pref2');
  });
});

describe('PrefStep1Page — 일괄 탈출 (AC4 · AC-11-1·2 · AC-14-1 · 5-3)', () => {
  // TRIP-718: Figma 1643:1183 에 하단 링크가 없어 제거 — 탈출구는 상단 하나(US-ONB-11 충족).
  it.each([['상단', 'onboarding-pref1-skip-top']])(
    '%s skip을 탭하면 홈으로 replace하고 5축이 전부 null로 유지된다',
    async (_label, testId) => {
      // 준비 — 아무 것도 고르지 않은 채 렌더(reset 직후).
      render(<PrefStep1Page />);

      // 실행 — skip 탭.
      fireEvent.press(screen.getByTestId(testId));

      // 단언 — 완료 성공·게이트 전환 뒤 홈으로 replace.
      await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
      // 단언 — 5축 전부 null 유지(빈 배열로 바뀌지 않는다 — US-ONB-14).
      const state = usePreferenceStore.getState();
      expect(state.styles).toBeNull();
      expect(state.pace).toBeNull();
      expect(state.companions).toBeNull();
      expect(state.foods).toBeNull();
      expect(state.transports).toBeNull();
    }
  );
});

describe('PrefStep1Page — 페이스 축 탭↔스토어 왕복 (AC3 · US-ONB-15 · 5-11)', () => {
  it('페이스 타일을 탭하면 그 타일이 선택 표시되고 스토어 pace가 바뀐다', () => {
    // 준비 — 렌더(스토어는 beforeEach가 이미 reset).
    render(<PrefStep1Page />);

    // 실행 — '균형' 페이스 타일을 탭(03b W-1 재현 원문과 같은 slug — 그 문서와 나란히
    // 읽을 수 있게).
    fireEvent.press(screen.getByTestId('onboarding-pref1-pace-balanced'));

    // 단언 ① — 읽기 경로: 타일이 선택 표시된다.
    expect(screen.getByTestId('onboarding-pref1-pace-balanced')).toBeSelected();
    // 단언 ② — 쓰기 경로: pace는 단일 축이라 배열이 아니라 원시값(toBe)이다.
    expect(usePreferenceStore.getState().pace).toBe('balanced');
  });
});

describe('PrefStep1Page — 온보딩 완료 재평가 신호 발화 (ticket AC-A · US-ONB-11 · TRIP-353)', () => {
  it.each([['상단', 'onboarding-pref1-skip-top']])(
    '%s 일괄 탈출을 탭하면 재평가 신호를 발화하고 홈으로 replace 한다',
    async (_label, testId) => {
      // 준비 — 렌더.
      render(<PrefStep1Page />);

      // 실행 — 일괄 탈출 탭.
      fireEvent.press(screen.getByTestId(testId));

      // 단언 — 취향 1/2 탈출도 재평가 신호를 발화(결함 A — pref2 뿐 아니라 여기서도) + replace 유지.
      await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
      expect(mockNotifyReeval).toHaveBeenCalledTimes(1);
    }
  );
});

describe('PrefStep1Page — 일괄 탈출은 기존 선택을 보존한다 (AC4 · US-ONB-11 · US-ONB-14 · 5-12)', () => {
  it('이미 고른 값이 있어도 skip은 그 값을 지우지 않고 홈으로 replace한다', async () => {
    // 준비 — 화면을 거치지 않고 스토어에 직접 선주입(여기 관심사는 "skip 핸들러가
    // 스토어를 건드리는가"이지 값이 어떻게 들어왔는가가 아니다 — 탭으로 만들 필요 없음).
    usePreferenceStore.getState().toggleStyle('rest');
    render(<PrefStep1Page />);

    // 실행 — 상단 skip을 탭(TRIP-718 로 하단 링크 제거).
    fireEvent.press(screen.getByTestId('onboarding-pref1-skip-top'));

    // 단언 ① — 이 케이스의 주제: skip 핸들러가 스토어를 건드리지 않아 styles가
    // 그대로 남는다(빈 배열로 초기화되지 않는다).
    expect(usePreferenceStore.getState().styles).toEqual(['rest']);
    // 단언 ② — 보존만 하고 못 나가면 반쪽이므로 내비도 함께 본다.
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
  });
});

// TRIP-1421 — 온보딩 완료를 닉네임 단계에서 취향 출구로 옮겼다(1/2 의 출구는 skip-top 하나).
describe('PrefStep1Page — skip-top 온보딩 완료 (TRIP-1421 AC3 · AC4 · AC5)', () => {
  it('skip-top 은 PUT 없이 완료를 보내고, 성공한 뒤에만 재평가·홈 이동을 한다 (AC3)', async () => {
    // 준비 — 완료 응답을 붙잡아 둔다.
    let resolveComplete!: () => void;
    mockCompleteOnboarding.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveComplete = resolve;
      })
    );
    render(<PrefStep1Page />);

    // 실행 ① — skip-top 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref1-skip-top'));
    await act(async () => {
      await Promise.resolve();
    });

    // 단언 ① — 완료 1회 · PUT 0회 · 아직 재평가·이동 없음.
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(mockPutMutate).not.toHaveBeenCalled();
    expect(mockNotifyReeval).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();

    // 실행 ② — 완료 성공.
    await act(async () => {
      resolveComplete();
    });

    // 단언 ② — 재평가 1 · 홈 1.
    await waitFor(() => expect(routerMock.replace.mock.calls).toEqual([['/']]));
    expect(mockNotifyReeval).toHaveBeenCalledTimes(1);
  });

  it('완료가 실패하면 화면에 남아 오류 한 줄을 보이고, 다시 누르면 재시도해 성공 시 홈으로 간다 (AC4)', async () => {
    // 준비 — 1차 실패, 2차 성공.
    mockCompleteOnboarding
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce(undefined);
    render(<PrefStep1Page />);
    // 앵커 — 누르기 전엔 오류가 없다.
    expect(screen.queryByTestId('onboarding-pref1-complete-error')).toBeNull();

    // 실행 ① — skip-top 탭(실패).
    fireEvent.press(screen.getByTestId('onboarding-pref1-skip-top'));

    // 단언 ① — 정확한 문구(완전 일치) · 재평가 0 · 이동 0.
    expect(
      await screen.findByTestId('onboarding-pref1-complete-error')
    ).toHaveTextContent(COMPLETE_ERROR);
    expect(mockNotifyReeval).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();

    // 실행 ② — 연타 창을 닫고 같은 출구를 다시 누른다(= 재시도).
    resetPressGuard();
    fireEvent.press(screen.getByTestId('onboarding-pref1-skip-top'));

    // 단언 ② — 완료 2회째 · 홈 1회.
    await waitFor(() => expect(routerMock.replace.mock.calls).toEqual([['/']]));
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(2);
  });

  it('응답을 기다리는 동안 skip-top 을 거듭 눌러도 완료 요청은 1회다 (AC5)', async () => {
    // 준비 — 완료 응답을 붙잡아 둔다(풀지 않는다).
    mockCompleteOnboarding.mockReturnValue(new Promise<void>(() => {}));
    render(<PrefStep1Page />);

    // 실행 — 세 번 누른다. 탭 사이마다 연타 창을 닫아 "응답 대기 잠금"만 시험한다.
    for (let i = 0; i < 3; i += 1) {
      resetPressGuard();
      fireEvent.press(screen.getByTestId('onboarding-pref1-skip-top'));
    }
    await act(async () => {
      await Promise.resolve();
    });

    // 단언 — 완료 요청 1회.
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
  });
});
