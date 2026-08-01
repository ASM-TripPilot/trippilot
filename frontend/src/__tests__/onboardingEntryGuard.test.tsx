import { render, screen } from '@testing-library/react-native';

import type { OnboardingProgress } from '@/features/onboarding/model/resolveOnboardingStep';
import { useOnboardingProgress } from '@/features/onboarding/model/useOnboardingProgress';
import OnboardingLayout from '@/app/(onboarding)/_layout';
import OnboardingIndex from '@/app/(onboarding)/index';

/**
 * T2-1 · T2-2 · T2-3 · T2-4 — (onboarding) 진입 자동 리다이렉트 가드.
 *
 * 무엇을 보장하나: 온보딩 그룹이 켜졌을 때
 *  (1) 진입 index 가 죽은 스텁이 아니라 진행 단계로 리다이렉트하고(T2-1),
 *  (2) 그 목적지가 resolveOnboardingStep 결과와 맞으며(T2-2, D1 축약: 미완=terms·완료=home),
 *  (3) 이미 완료한 사용자는 온보딩에 갇히지 않고 홈으로 되돌아가고(T2-3),
 *  (4) 미완 사용자가 nickname 등 하위 화면에 있어도 가드가 terms 로 튕겨 무한루프를 만들지 않는다(T2-4).
 *
 * 왜 이렇게 테스트하나: 라우트 컴포넌트는 router 가 렌더해 props 를 못 받으므로, 진행 상태는
 * useOnboardingProgress 훅 seam 으로 주입하고 목으로 갈아끼운다(SplashGate 가 useBootstrapGate 를
 * 목킹하는 패턴과 동일). expo-router 의 Redirect/Stack 은 라우터 컨텍스트 없이 관찰하려고
 * 마커로 목킹한다 — Redirect 는 목적지 href 를 'redirect-href' 텍스트로, Stack 은 자식 렌더를
 * 'onboarding-stack' 으로 노출한다.
 *
 * *(개념)* expo-router `<Redirect href>`: 렌더되는 즉시 href 로 이동시키는 선언형 리다이렉트.
 *   실제 이동 대신 "어디로 보내려 했는가"만 관찰하면 가드 로직을 라우터 없이 검증할 수 있다.
 */

// expo-router 를 관찰 마커로 대체(마커 본체는 test-support 모듈 — 상단 주해 참조).
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/test-support/expoRouterRedirectMock');
});

// 진행 상태 공급 훅을 목으로 세워, 임의 완료 상태를 주입한다.
jest.mock('@/features/onboarding/model/useOnboardingProgress', () => ({
  __esModule: true,
  useOnboardingProgress: jest.fn(),
}));

const mockUseOnboardingProgress = useOnboardingProgress as jest.MockedFunction<
  typeof useOnboardingProgress
>;

/** 이 진행 상태를 훅이 돌려주도록 세운다. */
function setProgress(progress: OnboardingProgress): void {
  mockUseOnboardingProgress.mockReturnValue(progress);
}

afterEach(() => {
  mockUseOnboardingProgress.mockReset();
});

describe('(onboarding)/index — 스텁 제거·진입 리다이렉트 (T2-1)', () => {
  it('아무것도 완료 안 한 진입은 죽은 스텁이 아니라 /(onboarding)/terms 로 리다이렉트된다', () => {
    // 준비 — 신규 가입자(약관·닉네임 모두 미완).
    setProgress({ termsCompleted: false, nicknameCompleted: false });

    // 실행 — 온보딩 그룹의 기본 라우트(index)가 렌더된다.
    render(<OnboardingIndex />);

    // 단언(긍정) — Redirect 가 그려지고 목적지가 약관 화면이다.
    expect(screen.getByTestId('redirect-href')).toHaveTextContent(
      '/(onboarding)/terms'
    );
    // 단언(부정) — 옛 스텁 텍스트로 착지하지 않는다(같은 it 에 묶어 공허한 통과 방지).
    expect(screen.queryByText('온보딩 (겹2/후속)')).toBeNull();
  });
});

describe('(onboarding)/index — 진행 판정 연결 (T2-2, D1 축약)', () => {
  it('미완이면 terms 로, 완료면 홈(/)으로 resolveOnboardingStep 결과대로 매핑한다', () => {
    // 미완 → terms.
    setProgress({ termsCompleted: false, nicknameCompleted: false });
    const { unmount } = render(<OnboardingIndex />);
    expect(screen.getByTestId('redirect-href')).toHaveTextContent(
      '/(onboarding)/terms'
    );
    unmount();

    // 완료 → 홈. D1: progress 는 onboardingCompleted 에서 유도되어 {true,true} → 'done'.
    setProgress({ termsCompleted: true, nicknameCompleted: true });
    render(<OnboardingIndex />);
    // 홈은 루트 게이트('/')로 되돌려 재판정한다(컨테이너들의 기존 관용과 동일).
    expect(screen.getByTestId('redirect-href')).toHaveTextContent(/^\/$/);
  });
});

describe('(onboarding)/_layout — 완료자 방어 리다이렉트 (T2-3)', () => {
  it('완료 상태로 그룹에 들어오면 홈(/)으로 되돌리고, 미완이면 갇히지 않고 화면을 그린다', () => {
    // 긍정 — 완료({true,true}→"done")면 홈으로 Redirect(온보딩에 갇히지 않는다).
    setProgress({ termsCompleted: true, nicknameCompleted: true });
    const { unmount } = render(<OnboardingLayout />);
    expect(screen.getByTestId('redirect-href')).toHaveTextContent(/^\/$/);
    unmount();

    // 부정(대조) — 미완이면 홈 Redirect 대신 자식 스택을 그린다.
    setProgress({ termsCompleted: false, nicknameCompleted: false });
    render(<OnboardingLayout />);
    expect(screen.queryByTestId('redirect-href')).toBeNull();
    expect(screen.getByTestId('onboarding-stack')).toBeOnTheScreen();
  });
});

describe('(onboarding)/_layout — 무한루프 회귀 가드 (T2-4)', () => {
  it('미완 사용자가 하위 화면(nickname 등)에 있어도 가드가 terms 로 튕기지 않고 자식을 그대로 그린다', () => {
    // 준비 — 선형 전진 중(약관 저장 후 nickname 착지) = 여전히 미완.
    setProgress({ termsCompleted: false, nicknameCompleted: false });

    // 실행 — 온보딩 레이아웃(모든 하위 화면을 감싼다)이 렌더된다.
    render(<OnboardingLayout />);

    // 단언(긍정) — 레이아웃이 자식(현재 화면)을 그대로 그린다.
    expect(screen.getByTestId('onboarding-stack')).toBeOnTheScreen();
    // 단언(부정) — 어떤 Redirect 도 렌더하지 않는다. terms 로 튕기면 terms↔nickname 무한루프가 된다.
    expect(screen.queryByTestId('redirect-href')).toBeNull();
  });
});
