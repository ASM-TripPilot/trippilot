import { render, screen } from '@testing-library/react-native';

import { NicknameScreen, type NicknameScreenProps } from './NicknameScreen';

/**
 * AC-N3 — 「사용 가능한 닉네임이에요」 긍정 상태만 남긴 뷰 단위 파일(B안 (c)).
 *
 * 나머지 화면 계약(도움말·형식/서버 오류·후보 칩·재생성·return 제출·탈출구 없음·머리 글자)은
 * `NicknamePage.integration.test.tsx` 가 실 react-query + MSW 로 본다(2026-11-01 B안 이전).
 * 이 갈래만 남긴 이유: `NicknamePage` 가 `availabilityConfirmed` 를 넘기지 않아 페이지로는 만들 수 없는
 * 상태다(프리뷰 `app/_dev/preview.tsx` 만 넘긴다).
 *
 * 3동작: 준비(props 로 상태를 세운다) → 실행(렌더) → 단언(긍정 안내가 보이는가).
 */

function makeProps(
  overrides: Partial<NicknameScreenProps> = {}
): NicknameScreenProps {
  return {
    value: '여행자1234',
    canProceed: true,
    errorReason: null,
    suggestions: [],
    onChange: jest.fn(),
    onRegenerate: jest.fn(),
    onSelectSuggestion: jest.fn(),
    onNext: jest.fn(),
    ...overrides,
  };
}

describe('NicknameScreen — 사용 가능 긍정 상태 (AC-N3)', () => {
  it('availabilityConfirmed 이면 "사용 가능한 닉네임이에요" 를 보여주고 helper 와 공존한다 (AC-INV2)', () => {
    render(<NicknameScreen {...makeProps()} availabilityConfirmed />);

    expect(
      screen.getByTestId('onboarding-nickname-available')
    ).toHaveTextContent('사용 가능한 닉네임이에요');
    expect(screen.getByTestId('onboarding-nickname-helper')).toHaveTextContent(
      '나중에 설정에서 바꿀 수 있어요'
    );
  });

  it.each([
    ['미전달', undefined],
    ['false', false],
  ])(
    'availabilityConfirmed 가 %s 이면 긍정 메시지를 그리지 않는다',
    (_label, value) => {
      render(<NicknameScreen {...makeProps()} availabilityConfirmed={value} />);

      expect(screen.getByTestId('onboarding-nickname-root')).toBeOnTheScreen();
      expect(screen.queryByTestId('onboarding-nickname-available')).toBeNull();
    }
  );

  it('오류가 있으면 긍정 메시지를 그리지 않는다 — 오류 우선', () => {
    render(
      <NicknameScreen
        {...makeProps({ errorReason: 'TAKEN', canProceed: false })}
        availabilityConfirmed
      />
    );

    expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-nickname-available')).toBeNull();
  });
});
