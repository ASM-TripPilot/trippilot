import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react-native';

import { SocialLoginScreen } from './SocialLoginScreen';

// 이 파일은 '비주얼 구조 가드'다. 픽셀은 jest 로 검증 불가(→ [검증] 단계 Figma 대조)라
// 다루지 않고, 재구현 후 브랜드 아이콘 SVG 가 '존재'하는지만 새 testID 로 확인한다.
//
// 계약 동결: 이 파일은 기본(idle) 상태 렌더에서 '새 아이콘 testID 존재'만 본다.
// props 8개·조건부 UI(에러/충돌/연령 시트)·기존 testID 는 SocialLoginScreen.test.tsx 가
// 잠근 행위 계약이므로 여기서 건드리지 않는다(약화·중복 금지).
//
// @gorhom/bottom-sheet 은 reanimated/gesture 런타임 의존이라 수동 목으로 대체한다
// (기존 테스트와 동일 규약: __mocks__/@gorhom/bottom-sheet.tsx). react-native-svg·
// expo-linear-gradient 는 미설치라 이 파일에서 직접 import 하지 않는다.
jest.mock('@gorhom/bottom-sheet');

type Props = ComponentProps<typeof SocialLoginScreen>;

// 기본(idle) 상태로만 렌더한다 — 조건부 UI/props 는 계약 동결이라 기본값으로 고정한다.
function renderDefault() {
  const props: Props = {
    phase: 'idle',
    errorCode: null,
    conflictProvider: null,
    onSignIn: jest.fn(),
    onConflictContinue: jest.fn(),
    onConflictCancel: jest.fn(),
    onAgeConfirm: jest.fn(),
    onAgeCancel: jest.fn(),
  };
  render(<SocialLoginScreen {...props} />);
}

describe('c02-social-login 비주얼 구조 가드 (AC-VS-5~6 · 신규 실패 테스트)', () => {
  it.each(['google', 'apple', 'kakao', 'naver'])(
    'AC-VS-5 %s 소셜 버튼 안에 브랜드 아이콘 SVG 가 렌더된다 — 텍스트 전용이 아니다',
    (provider) => {
      // 준비: 기본 상태로 렌더하고 해당 provider 의 버튼(기존 계약 testID)을 잡는다.
      renderDefault();
      const button = screen.getByTestId(`auth-login-${provider}`);
      // 실행+단언: 버튼 안에 브랜드 아이콘 SVG(신규 testID)가 중첩돼야 한다.
      // (현재는 라벨 텍스트만 → 아이콘 없음 → red)
      expect(
        within(button).getByTestId(`auth-login-${provider}-icon`)
      ).toBeOnTheScreen();
    }
  );

  it('AC-VS-6 브랜드 블록에 앱아이콘 글리프 SVG 가 렌더된다', () => {
    // 준비: 기본 상태로 렌더하고 브랜드 블록(기존 계약 testID)을 잡는다.
    renderDefault();
    const brand = screen.getByTestId('auth-login-brand');
    // 실행+단언: 브랜드 블록 안에 앱아이콘 글리프 SVG(신규 testID)가 중첩돼야 한다.
    // (현재는 타이틀 텍스트만 → 글리프 없음 → red)
    expect(
      within(brand).getByTestId('auth-login-logo-glyph')
    ).toBeOnTheScreen();
  });
});
