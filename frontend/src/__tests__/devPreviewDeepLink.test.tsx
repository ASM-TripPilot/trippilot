import type { ComponentType } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

/**
 * dev 정적 프리뷰 딥링크 조준 — `trippilot://_dev/preview?state=X` 의 `state` 쿼리
 * 파라미터로 초기 화면 상태를 정한다 (Seed 완료 정의 5 · 대조 매트릭스 9프레임, TRIP-162).
 *
 * 계약:
 *  (1) 매트릭스 9개 state 키 각각이 딥링크만으로 해당 화면을 **초기 렌더**한다
 *      (소스 수정·토글 탭 없이 — 스크린샷 대조 루프의 자동 조준 전제),
 *  (2) 잘못된/미존재/비문자열 값은 에러 화면 없이 **결정론적으로 splash 폴백** (INV-4 정신),
 *  (3) 딥링크는 초기 상태만 정한다 — 진입 후 토글 전환은 그대로 동작한다,
 *  (4) `splash-loading` 은 프리뷰의 정식 상태다(토글로도 진입 가능).
 *
 * 파라미터 수신은 expo-router 의 `useLocalSearchParams` 로 한다 — 현재 화면 URL 의
 * 쿼리 문자열(?state=X)을 객체로 돌려주는 훅이다. 실제 라우터 없이 검증하기 위해
 * 모듈 전체를 목으로 바꾼다 → 프리뷰는 expo-router 에서 이 훅만 가져와야 한다(목의 계약).
 *
 * 동결 devPreview.test.tsx 는 expo-router 목 **없이** 렌더한다 — 구현은 라우터
 * 컨텍스트/파라미터가 없어도 크래시 없이 기존 초기 상태(splash)로 동작해야 한다.
 * 네트워크 지뢰 목(정적 그래프 오염 감시)도 그 동결 파일이 전담하므로 여기서 중복하지 않는다.
 */

// jest.mock 팩토리는 파일 상단으로 호이스트되지만, `mock` 접두 변수는 참조가 허용된다.
// 테스트마다 이 객체를 고쳐 "딥링크로 어떤 쿼리가 왔는가"를 흉내낸다.
const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// @gorhom/bottom-sheet 은 reanimated/gesture 런타임 의존이라 통과 컴포넌트로 목킹한다
// (수동 목: __mocks__/@gorhom/bottom-sheet.tsx — 동결 devPreview.test 와 같은 장치).
jest.mock('@gorhom/bottom-sheet');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevPreview = require('@/app/_dev/preview').default as ComponentType;

beforeEach(() => {
  delete mockSearchParams.state;
});

// 대조 매트릭스 9프레임 ↔ 기존 PREVIEW_STATES 키(+ 신규 splash-loading) ↔ 그 상태에만
// 나타나는 실물 화면 마커. 마커는 동결 devPreview.test 와 같은 원칙으로 고른다.
const MATRIX_CASES = [
  { frame: 'c01 default', state: 'splash', marker: 'shell-splash-root' },
  {
    frame: 'c01 loading',
    state: 'splash-loading',
    marker: 'shell-splash-progress-dot-active',
  },
  { frame: 'c02 default', state: 'login-idle', marker: 'auth-login-root' },
  {
    frame: 'c02 conflict',
    state: 'login-conflict-sheet',
    marker: 'auth-login-conflict-sheet',
  },
  {
    frame: 'c02 error',
    state: 'login-error-banner',
    marker: 'auth-login-error-banner',
  },
  {
    frame: 'c06 default',
    state: 'onboarding-terms-default',
    marker: 'onboarding-terms-missing',
  },
  {
    frame: 'c07 default',
    state: 'onboarding-nickname-default',
    marker: 'onboarding-nickname-helper',
  },
  {
    frame: 'c08 default',
    state: 'onboarding-location-default',
    marker: 'onboarding-location-purpose',
  },
  {
    frame: 'c08 denied',
    state: 'onboarding-location-denied',
    marker: 'onboarding-location-denied-notice',
  },
] as const;

describe('dev 프리뷰 딥링크 조준 — ?state=X 로 초기 상태를 정한다', () => {
  it.each(MATRIX_CASES)(
    '$frame: state=$state 로 열면 $marker 가 초기 렌더된다',
    ({ state, marker }) => {
      mockSearchParams.state = state;

      render(<DevPreview />);

      // 토글을 누르지 않았다 — 딥링크만으로 이 화면이 떠야 자동 조준이 성립한다.
      expect(screen.getByTestId(marker)).toBeOnTheScreen();
    }
  );

  it('state=splash 는 loading 강조 없는 기본 스플래시다 — 두 프레임이 구별된다', () => {
    mockSearchParams.state = 'splash';

    render(<DevPreview />);

    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('shell-splash-progress-dot-active')).toBeNull();
  });
});

describe('dev 프리뷰 딥링크 — 잘못된 값은 splash 로 결정론 폴백 (INV-4 정신)', () => {
  it.each([
    ['미존재 키 문자열', 'no-such-state'],
    ['파라미터 자체가 없음', undefined],
    ['비문자열(중복 쿼리 → 배열)', ['onboarding-terms-default', 'splash']],
  ])('state 가 %s 이면 에러 화면 없이 splash 를 그린다', (_label, value) => {
    if (value !== undefined) {
      mockSearchParams.state = value;
    }

    render(<DevPreview />);

    // 폴백의 결정론: 항상 splash — 다른 화면이 섞여 뜨지 않는다.
    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-login-root')).toBeNull();
    expect(screen.queryByTestId('onboarding-terms-root')).toBeNull();
  });
});

describe('dev 프리뷰 딥링크 — 초기 상태만 정하고 토글은 그대로 동작한다', () => {
  it('딥링크로 연 뒤에도 다른 상태 토글을 누르면 그 화면으로 전환된다', () => {
    mockSearchParams.state = 'onboarding-terms-default';
    render(<DevPreview />);

    fireEvent.press(
      screen.getByTestId('dev-preview-state-onboarding-nickname-default')
    );

    // 파라미터를 매 렌더 상태로 박아버리면(토글 잠김) 이 단언이 실패한다.
    expect(screen.getByTestId('onboarding-nickname-helper')).toBeOnTheScreen();
  });

  it('splash-loading 은 정식 프리뷰 상태다 — 토글로도 진입된다', () => {
    render(<DevPreview />);

    fireEvent.press(screen.getByTestId('dev-preview-state-splash-loading'));

    expect(
      screen.getByTestId('shell-splash-progress-dot-active')
    ).toBeOnTheScreen();
  });
});
