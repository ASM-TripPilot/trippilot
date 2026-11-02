import { render, screen } from '@testing-library/react-native';

import PermissionPushWebRoute from '@routes/permission-push.web';
import OnboardingPushWebRoute from '@routes/(onboarding)/push.web';

/**
 * TRIP-1648 · A6 — 웹에서는 푸시 안내 카드 두 라우트가 카드를 그리지 않고 다음 곳으로 바로 보낸다.
 *
 * 무엇을 보장하나:
 *  - 온보딩 푸시 카드(`(onboarding)/push`)는 취향 1/2(`/(onboarding)/pref1`) 로, 기존 계정 안내 카드(`permission-push`)는
 *    홈(`/(tabs)`)으로 `Redirect` 한다. 웹엔 푸시가 없어 카드를 보여 주면 `계속` 이 아무 일도 안 하는 버튼이 된다(INV-4).
 *    `href` 는 문자열 그대로여야 한다.
 *
 * 이 파일이 `.web` 라우트를 이름으로 직접 불러오는 이유: jest-expo 는 iOS 기준이라 `.web.tsx` 를 자동으로 고르지 않는다.
 * expo-router 가 웹 빌드에서 `push.web.tsx` 를 `push.tsx` 대신 고르는지는 jest 가 못 본다([검증]의 웹 export 몫).
 * (개념) `Redirect` — 렌더되면 그 주소로 이동시키는 expo-router 컴포넌트. 여기선 이동하지 않고 "어디로 보내려 했나"만
 *   텍스트로 보이는 공용 목(`expoRouterRedirectMock`)을 쓴다.
 * 3동작: 준비(Redirect 목) → 실행(웹 라우트 렌더) → 단언(`redirect-href` 텍스트).
 */

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterRedirectMock')
);

describe('웹 전용 푸시 라우트 — 카드 대신 이동', () => {
  it('온보딩 푸시 카드 자리는 취향 1/2 로 보낸다', () => {
    render(<OnboardingPushWebRoute />);

    expect(screen.getByTestId('redirect-href')).toHaveTextContent(
      '/(onboarding)/pref1'
    );
  });

  it('기존 계정 안내 카드 자리는 홈 탭으로 보낸다', () => {
    render(<PermissionPushWebRoute />);

    expect(screen.getByTestId('redirect-href')).toHaveTextContent('/(tabs)');
  });
});
