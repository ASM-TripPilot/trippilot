import { fireEvent, render, screen } from '@testing-library/react-native';

import { NicknameScreen, type NicknameScreenProps } from './NicknameScreen';

/**
 * AC B3 · B4 · B5 · B6 · B7 · C6 — c07-nickname 프레젠테이션 계약.
 *
 * 무엇을 보장하나: 서버가 내린 판정(중복·금칙어)과 클라 형식 판정(길이)을 화면이 **같은 자리에**
 * 인라인 오류로 보여주고, 대체 후보를 한 번의 탭으로 적용할 수 있게 내놓는가.
 *
 * 권한 경계: 이 화면은 `errorReason` 을 **판정하지 않고 표시만** 한다. TAKEN·BANNED_WORD 는
 * 서버 응답에서만 들어오는 값이다(루트 CLAUDE.md — 판정 정본은 서버).
 *
 * 3동작: 준비(props 로 상태를 세운다) → 실행(렌더/탭) → 단언(무엇이 보이고 무엇이 호출되는가).
 */

const SUGGESTIONS = ['여행자1234', '노을수집가', '골목탐험가'];

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

describe('NicknameScreen — 기본 안내 (AC B3)', () => {
  it('"나중에 설정에서 바꿀 수 있어요" 안내를 보여준다 (US-ONB-03 정상 AC · D6 병기)', () => {
    render(<NicknameScreen {...makeProps()} />);

    // Figma c07 에는 이 문구가 없지만 US-ONB-03 이 명시적으로 요구한다 → 기본 helper 에 병기(D6).
    expect(screen.getByTestId('onboarding-nickname-helper')).toHaveTextContent(
      '나중에 설정에서 바꿀 수 있어요'
    );
  });

  it('전달받은 닉네임이 입력란에 채워져 보인다', () => {
    render(<NicknameScreen {...makeProps({ value: '노을수집가' })} />);

    expect(screen.getByTestId('onboarding-nickname-input')).toHaveDisplayValue(
      '노을수집가'
    );
  });
});

describe('NicknameScreen — 형식 오류 (AC B4 · 클라 UX 사본)', () => {
  it.each([['TOO_SHORT' as const], ['TOO_LONG' as const]])(
    '%s 이면 인라인 오류가 뜨고 다음이 잠긴다 (길이 규칙 위반)',
    (reason) => {
      render(
        <NicknameScreen
          {...makeProps({ errorReason: reason, canProceed: false })}
        />
      );

      expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen();
      expect(screen.getByTestId('onboarding-nickname-next')).toBeDisabled();
    }
  );

  it('오류가 없으면 인라인 오류를 띄우지 않고 다음이 열린다', () => {
    render(<NicknameScreen {...makeProps()} />);

    expect(screen.getByTestId('onboarding-nickname-next')).toBeEnabled();
    expect(screen.queryByTestId('onboarding-nickname-error')).toBeNull();
  });
});

describe('NicknameScreen — 서버 판정 표시 (AC B5 · B6)', () => {
  it.each([['TAKEN' as const], ['BANNED_WORD' as const]])(
    '서버가 %s 로 응답한 상태면 인라인 오류와 대체 후보 칩을 함께 보여준다',
    (reason) => {
      render(
        <NicknameScreen
          {...makeProps({
            errorReason: reason,
            canProceed: false,
            suggestions: SUGGESTIONS,
          })}
        />
      );

      expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen();
      // D6 — 대체 후보 3개를 칩으로 나열한다.
      SUGGESTIONS.forEach((_, index) => {
        expect(
          screen.getByTestId(`onboarding-nickname-suggest-${index}`)
        ).toBeOnTheScreen();
      });
    }
  );

  it('대체 후보가 없으면 칩 영역을 그리지 않는다', () => {
    render(<NicknameScreen {...makeProps({ suggestions: [] })} />);

    expect(screen.getByTestId('onboarding-nickname-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-nickname-suggest-0')).toBeNull();
  });
});

describe('NicknameScreen — 원탭 적용 (AC B7)', () => {
  it('후보 칩을 탭하면 그 후보 값이 그대로 상위로 전달된다', () => {
    const onSelectSuggestion = jest.fn();
    render(
      <NicknameScreen
        {...makeProps({
          errorReason: 'TAKEN',
          canProceed: false,
          suggestions: SUGGESTIONS,
          onSelectSuggestion,
        })}
      />
    );

    fireEvent.press(screen.getByTestId('onboarding-nickname-suggest-1'));

    // 인덱스가 아니라 **값**이 올라가야 한다 — 목록이 갱신돼도 엉뚱한 값이 적용되지 않는다.
    expect(onSelectSuggestion).toHaveBeenCalledWith(SUGGESTIONS[1]);
  });
});

describe('NicknameScreen — 재생성 (Figma c07 재생성 아이콘)', () => {
  it('재생성 버튼을 탭하면 새 후보 요청이 상위로 전달된다', () => {
    const onRegenerate = jest.fn();
    render(<NicknameScreen {...makeProps({ onRegenerate })} />);

    fireEvent.press(screen.getByTestId('onboarding-nickname-regenerate'));

    expect(onRegenerate).toHaveBeenCalled();
  });
});

describe('NicknameScreen — 탈출구 없음 (AC C6 · BR-U0-20)', () => {
  // 부정 단언만 두면 빈 화면도 통과하므로 루트 존재와 짝짓는다.
  // 주의: "나중에 설정에서 바꿀 수 있어요"(B3)는 남아야 하므로 '나중에' 를 금칙 문구로 쓰지 않는다.
  it('닉네임 단계에는 건너뛰기 수단이 존재하지 않는다', () => {
    render(<NicknameScreen {...makeProps()} />);

    expect(screen.getByTestId('onboarding-nickname-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-nickname-skip')).toBeNull();
    expect(screen.queryByText(/건너뛰기|건너뛰고 시작/)).toBeNull();
  });
});
