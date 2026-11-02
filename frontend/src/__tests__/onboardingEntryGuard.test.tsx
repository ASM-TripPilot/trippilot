import { render, screen } from '@testing-library/react-native';

import OnboardingLayout from '@routes/(onboarding)/_layout';

/**
 * (onboarding)/_layout — 진행 판정 없이 자식 Stack 만 그린다 (TRIP-1421 AC13 · 옛 T2-3 반전 · T2-4 승계).
 *
 * 무엇을 보장하나: 레이아웃은 Redirect 하지 않는다.
 *  - 옛 T2-3("완료면 '/'로")은 뒤집혔다 — 그룹 안에서 '/'는 온보딩 index 로 되풀려 막다른 루프가 된다.
 *    완료자 방어는 루트 게이트(SplashGate 의 Stack.Protected)가 이미 한다.
 *  - T2-4(하위 화면에서 terms 로 튕기지 않음)는 판정이 없으니 구조적으로 성립한다.
 *  - 진입 판정(index)은 GET 3개를 실제로 도는 `onboardingEntryGuard.integration.test.tsx` 가 본다.
 *
 * QueryClientProvider 없이 그리므로, 레이아웃에 네트워크 판정(useQuery)이 들어오면 렌더 자체가 던진다.
 */

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/test-support/expoRouterRedirectMock');
});

describe('(onboarding)/_layout — 진행 판정 없이 Stack 만 (AC13)', () => {
  it('Redirect 없이 자식 화면을 그대로 그린다', () => {
    // 실행 — 온보딩 레이아웃(모든 하위 화면을 감싼다)을 그린다.
    render(<OnboardingLayout />);

    // 단언 — 자식 스택이 그려지고, 어디로도 보내지 않는다.
    expect(screen.getByTestId('onboarding-stack')).toBeOnTheScreen();
    expect(screen.queryByTestId('redirect-href')).toBeNull();
  });
});
