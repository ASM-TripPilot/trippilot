import type { ComponentType } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

/**
 * dev 정적 프리뷰(`src/app/_dev/preview.tsx`) — 눈으로 확인해야 하는 7개 시각 상태를
 * 네트워크·훅·컨테이너를 거치지 않고 그린다.
 *
 * 무엇을 보장하나:
 *  (1) 7개 상태 토글이 모두 있고, 각 토글이 해당 화면 상태를 실제로 그린다,
 *  (2) 그리는 대상이 **실물 화면 컴포넌트**다 — 단언하는 testID 가 전부
 *      SocialLoginScreen·SplashScreen 자신의 것이라, 프리뷰가 화면을 흉내 낸 별도 마크업을
 *      세우면 통과하지 못한다,
 *  (3) 그 과정에서 네트워크 계층·컨테이너·훅을 **런타임에 한 번도 로드하지 않는다**.
 *
 * (3)을 어떻게 보장하나 — 아래 지뢰(landmine) 목: 해당 모듈이 실제로 require 되는 순간
 * 팩토리가 예외를 던져 스위트가 즉시 터진다. 소스를 정규식으로 훑는 방식과 달리
 * **전이 의존까지** 잡힌다(프리뷰가 직접 import 하지 않아도, 그리는 컴포넌트가 끌고 오면 터진다).
 * 화면들이 `@/shared/api`·`useSocialLogin` 에서 가져오는 것은 `import type` 뿐이라
 * 컴파일 시 지워진다 — 그래서 값으로 로드되면 그건 진짜 회귀다.
 *
 * 왜 src/app 이 아니라 src/__tests__ 인가: expo-router 의 require.context 정규식은
 * `.test.tsx` 를 제외하지 않는다 → src/app/ 아래에 테스트 파일을 두면 실제 라우트로 등록된다.
 */

// @gorhom/bottom-sheet 은 reanimated/gesture 런타임 의존이라 통과 컴포넌트로 목킹한다.
// 목 본체는 __mocks__/@gorhom/bottom-sheet.tsx (수동 목) 에 있다.
jest.mock('@gorhom/bottom-sheet');

jest.mock('@/shared/api', () => {
  throw new Error('프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다');
});

jest.mock('@/features/auth/containers/SocialLoginContainer', () => {
  throw new Error(
    '프리뷰가 SocialLoginContainer(컨테이너)를 런타임에 로드했다'
  );
});

jest.mock('@/features/auth/containers/SplashGate', () => {
  throw new Error('프리뷰가 SplashGate(컨테이너)를 런타임에 로드했다');
});

jest.mock('@/features/auth/hooks/useSocialLogin', () => {
  throw new Error('프리뷰가 useSocialLogin(훅)을 런타임에 로드했다');
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevPreview = require('@/app/_dev/preview').default as ComponentType;

// 토글 키 ↔ 그 상태에서 나타나야 하는 실물 화면의 testID.
const CASES = [
  { key: 'splash', marker: 'shell-splash-root' },
  { key: 'login-idle', marker: 'auth-login-root' },
  { key: 'login-cancelled', marker: 'auth-login-cancel-notice' },
  { key: 'login-error-banner', marker: 'auth-login-error-banner' },
  { key: 'login-conflict-sheet', marker: 'auth-login-conflict-sheet' },
  { key: 'login-age-sheet', marker: 'auth-age-sheet' },
  { key: 'login-age-restriction', marker: 'auth-age-restriction' },
] as const;

// idle 은 "조건부 UI 가 하나도 없는 상태"라는 뜻이라, 나머지 6개의 부재로 정의된다.
const CONDITIONAL_MARKERS = [
  'auth-login-cancel-notice',
  'auth-login-error-banner',
  'auth-login-conflict-sheet',
  'auth-age-sheet',
  'auth-age-restriction',
];

function selectState(key: string) {
  fireEvent.press(screen.getByTestId(`dev-preview-state-${key}`));
}

describe('dev 정적 프리뷰 — 7개 시각 상태', () => {
  it('마운트 즉시 프리뷰 루트와 7개 상태 토글을 그린다', () => {
    render(<DevPreview />);

    expect(screen.getByTestId('dev-preview-root')).toBeOnTheScreen();
    CASES.forEach(({ key }) => {
      expect(screen.getByTestId(`dev-preview-state-${key}`)).toBeOnTheScreen();
    });
  });

  it.each(CASES)(
    '$key 토글을 누르면 실물 화면의 $marker 가 그려진다',
    ({ key, marker }) => {
      render(<DevPreview />);

      selectState(key);

      expect(screen.getByTestId(marker)).toBeOnTheScreen();
    }
  );

  it('login-idle 에서는 조건부 UI(취소·에러·충돌·연령)가 하나도 뜨지 않는다', () => {
    render(<DevPreview />);

    selectState('login-idle');

    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    CONDITIONAL_MARKERS.forEach((marker) => {
      expect(screen.queryByTestId(marker)).toBeNull();
    });
  });

  it('login-conflict-sheet 는 어떤 제공자와 충돌했는지까지 보여준다', () => {
    render(<DevPreview />);

    selectState('login-conflict-sheet');

    // 정규식으로 부분 일치를 본다 — 문구 전체를 박으면 카피 수정마다 테스트가 깨진다.
    expect(screen.getByTestId('auth-login-conflict-message')).toHaveTextContent(
      /kakao/
    );
  });

  it('보기 전용이라 화면 안의 버튼을 눌러도 상태가 바뀌지 않는다', () => {
    render(<DevPreview />);
    selectState('login-idle');

    fireEvent.press(screen.getByTestId('auth-login-google'));

    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    CONDITIONAL_MARKERS.forEach((marker) => {
      expect(screen.queryByTestId(marker)).toBeNull();
    });
  });
});
