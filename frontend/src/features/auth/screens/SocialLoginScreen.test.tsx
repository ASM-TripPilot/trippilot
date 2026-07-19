import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SocialLoginScreen } from './SocialLoginScreen';

// @gorhom/bottom-sheet 은 reanimated/gesture 런타임 의존이라 통과 컴포넌트로 목킹한다.
// 목 본체는 __mocks__/@gorhom/bottom-sheet.tsx (수동 목) 에 있다 — 인라인 팩토리로 두면
// NativeWind babel 의 _ReactNativeCSSInterop 주입이 out-of-scope 로 걸리기 때문이다.
jest.mock('@gorhom/bottom-sheet');

type Props = ComponentProps<typeof SocialLoginScreen>;

function renderScreen(overrides: Partial<Props> = {}) {
  const props: Props = {
    phase: 'idle',
    errorCode: null,
    conflictProvider: null,
    onSignIn: jest.fn(),
    onConflictContinue: jest.fn(),
    onConflictCancel: jest.fn(),
    onAgeConfirm: jest.fn(),
    onAgeCancel: jest.fn(),
    ...overrides,
  };
  render(<SocialLoginScreen {...props} />);
  return props;
}

describe('c02-social-login — 기본 화면 (AC-ONB-01-12 · §10 이메일 버튼 숨김)', () => {
  it('브랜드와 소셜 4버튼(구글·애플·카카오·네이버)·약관 안내를 렌더한다', () => {
    renderScreen();
    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-brand')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-google')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-apple')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-kakao')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-naver')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-terms')).toBeOnTheScreen();
  });

  it('이메일 회원가입 버튼·디바이더는 렌더하지 않는다 (§10 결정: 숨김)', () => {
    renderScreen();
    expect(screen.queryByTestId('auth-login-signup')).toBeNull();
    expect(screen.queryByTestId('auth-login-divider')).toBeNull();
  });

  it('소셜 버튼 testID 는 {feature}-{screen}-{role} 규약을 따른다 (AC-ONB-01-12)', () => {
    renderScreen();
    ['google', 'apple', 'kakao', 'naver'].forEach((role) => {
      const node = screen.getByTestId(`auth-login-${role}`);
      expect(node.props.testID).toMatch(/^auth-login-[a-z]+$/);
    });
  });

  it('소셜 버튼 탭은 해당 provider 로 onSignIn 을 호출한다', () => {
    const props = renderScreen();
    fireEvent.press(screen.getByTestId('auth-login-google'));
    expect(props.onSignIn).toHaveBeenCalledWith('google');
    fireEvent.press(screen.getByTestId('auth-login-kakao'));
    expect(props.onSignIn).toHaveBeenCalledWith('kakao');
  });

  it('기본 화면에는 취소 토스트·에러 배너·충돌 시트·연령 시트가 없다', () => {
    renderScreen();
    expect(screen.queryByTestId('auth-login-cancel-notice')).toBeNull();
    expect(screen.queryByTestId('auth-login-error-banner')).toBeNull();
    expect(screen.queryByTestId('auth-login-conflict-sheet')).toBeNull();
    expect(screen.queryByTestId('auth-age-sheet')).toBeNull();
  });

  it('어떤 요소도 소요시간(duration)을 표시하지 않는다 (INV-3, AC-ONB-01-11)', () => {
    renderScreen();
    expect(screen.queryByText(/소요\s*시간|duration/i)).toBeNull();
  });
});

describe('c02-social-login — 취소 안내 (AC-ONB-01-4)', () => {
  it('phase=cancelled 이면 "로그인이 취소되었습니다" 토스트를 표시한다', () => {
    renderScreen({ phase: 'cancelled' });
    const notice = screen.getByTestId('auth-login-cancel-notice');
    expect(notice).toBeOnTheScreen();
    expect(screen.getByText('로그인이 취소되었습니다')).toBeOnTheScreen();
  });
});

describe('c02-social-login — 에러 배너 (AC-ONB-01-5)', () => {
  it('phase=error·SOCIAL_AUTH_FAILED 이면 에러 배너와 안내 문구를 표시하고 소셜 버튼은 유지한다', () => {
    renderScreen({ phase: 'error', errorCode: 'SOCIAL_AUTH_FAILED' });
    expect(screen.getByTestId('auth-login-error-banner')).toBeOnTheScreen();
    expect(
      screen.getByText('로그인에 실패했어요. 잠시 후 다시 시도해 주세요')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-google')).toBeOnTheScreen();
  });

  it('phase=error·RATE_LIMITED 도 동일 에러 배너를 표시한다', () => {
    renderScreen({ phase: 'error', errorCode: 'RATE_LIMITED' });
    expect(screen.getByTestId('auth-login-error-banner')).toBeOnTheScreen();
  });
});

describe('c02-social-login — 이메일 충돌 바텀시트 (AC-ONB-01-6)', () => {
  it('SOCIAL_EMAIL_CONFLICT + 기존 provider 있으면 시트 제목·기존 provider 안내·CTA 를 표시한다', () => {
    const props = renderScreen({
      phase: 'error',
      errorCode: 'SOCIAL_EMAIL_CONFLICT',
      conflictProvider: '카카오',
    });
    expect(screen.getByTestId('auth-login-conflict-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-conflict-title')).toHaveTextContent(
      '이미 가입된 계정이에요'
    );
    expect(screen.getByText(/카카오/)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('auth-login-conflict-continue'));
    expect(props.onConflictContinue).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('auth-login-conflict-cancel'));
    expect(props.onConflictCancel).toHaveBeenCalledTimes(1);
  });

  it('기존 provider 필드가 없으면 일반 문구로 폴백한다 (§10)', () => {
    renderScreen({
      phase: 'error',
      errorCode: 'SOCIAL_EMAIL_CONFLICT',
      conflictProvider: null,
    });
    expect(
      screen.getByText('다른 방법으로 가입된 계정이에요')
    ).toBeOnTheScreen();
  });
});

describe('c02-social-login — 연령확인·연령 제한 (AC-ONB-01-7)', () => {
  it('phase=needs-age 이면 만 14세 확인 바텀시트를 표시하고 확인 시 onAgeConfirm 을 호출한다 (SELF_DECLARED)', () => {
    const props = renderScreen({ phase: 'needs-age' });
    expect(screen.getByTestId('auth-age-sheet')).toBeOnTheScreen();
    expect(screen.getByText(/만\s*14세/)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('auth-age-sheet-confirm'));
    expect(props.onAgeConfirm).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('auth-age-sheet-cancel'));
    expect(props.onAgeCancel).toHaveBeenCalledTimes(1);
  });

  it('phase=error·AGE_NOT_MET 이면 연령 제한 안내를 표시한다 (계정 미생성)', () => {
    renderScreen({ phase: 'error', errorCode: 'AGE_NOT_MET' });
    expect(screen.getByTestId('auth-age-restriction')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-login-conflict-sheet')).toBeNull();
  });
});
