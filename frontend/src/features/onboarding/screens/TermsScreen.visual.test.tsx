import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { TermsScreen, type TermsScreenProps } from './TermsScreen';

/**
 * c06-terms Figma 정합(1293:1208) — 신규 요소 구조 가드 (AC-T1 · AC-T4 · AC-T5, TRIP-162).
 *
 * 이 파일은 '비주얼 구조 가드'다. 픽셀(배지 색·radius·hairline)은 jest 로 검증할 수 없으므로
 * 다루지 않고 — 그건 [검증] 단계의 Figma 스크린샷 대조 몫이다 — 신규 요소가 '존재'하고
 * seam 콜백이 계약대로 호출되는지만 확인한다.
 *
 * 기존 계약과의 관계: 필수/선택 텍스트 자체는 동결 테스트(TermsScreen.test.tsx)가
 * getAllByText('필수')×2 로 이미 고정한다 — 여기서는 그 텍스트가 **배지 요소 안**에
 * 들어갔는지(신규 testID)만 추가로 본다.
 */

// onViewTerms 는 게이트① 시점에 아직 없는 prop 이다. 동결 화면 소스를 고칠 수 없으므로
// "구현 후의 계약"을 확장 타입으로 선언하고 재대입한다 — 지금도 컴파일되고(더 좁은 props 를
// 받는 컴포넌트는 더 넓은 props 자리에 대입 가능), 구현 후에도 그대로 유효하다.
type TermsScreenPropsNext = TermsScreenProps & {
  /** seam — 행의 "보기"를 누르면 어느 약관인지 상위로 알리는 무동작 optional 콜백 (Q2-a). */
  onViewTerms?: (termsType: string) => void;
};
const TermsScreenNext: (props: TermsScreenPropsNext) => ReactElement =
  TermsScreen;

// 동결 테스트의 픽스처를 그대로 복제한다(동결 파일은 export 하지 않으므로 재사용 불가).
function makeProps(
  overrides: Partial<TermsScreenPropsNext> = {}
): TermsScreenPropsNext {
  return {
    items: [
      {
        termsType: 'TERMS_OF_SERVICE',
        version: '1.4',
        label: '서비스 이용약관',
        required: true,
        checked: false,
      },
      {
        termsType: 'PRIVACY_POLICY',
        version: '2.1',
        label: '개인정보 처리방침',
        required: true,
        checked: false,
      },
      {
        termsType: 'MARKETING',
        version: '1.2',
        label: '마케팅 정보 수신 동의',
        required: false,
        checked: false,
      },
    ],
    allChecked: false,
    canProceed: false,
    missingRequiredLabels: [],
    errorMessage: null,
    onToggle: jest.fn(),
    onToggleAll: jest.fn(),
    onNext: jest.fn(),
    onRetry: jest.fn(),
    ...overrides,
  };
}

describe('TermsScreen — 내비바 (AC-T4)', () => {
  it('상단 내비바 타이틀 "약관 동의" 를 렌더한다', () => {
    render(<TermsScreenNext {...makeProps()} />);

    // 정확 일치 조회 — 본문 타이틀("약관에 동의해 주세요")과 겹치지 않는다.
    expect(screen.getByText('약관 동의')).toBeOnTheScreen();
  });
});

describe('TermsScreen — 필수/선택 배지 (AC-T1)', () => {
  it('필수 행에는 "필수" 배지, 선택 행에는 "선택" 배지가 item.required 로 파생돼 렌더된다', () => {
    render(<TermsScreenNext {...makeProps()} />);

    // 배지는 평문 텍스트가 아니라 별도 요소여야 스크린샷 대조에서 pill 로 그릴 수 있다.
    expect(
      screen.getByTestId('onboarding-terms-badge-TERMS_OF_SERVICE')
    ).toHaveTextContent('필수');
    expect(
      screen.getByTestId('onboarding-terms-badge-PRIVACY_POLICY')
    ).toHaveTextContent('필수');
    expect(
      screen.getByTestId('onboarding-terms-badge-MARKETING')
    ).toHaveTextContent('선택');
  });
});

describe('TermsScreen — "보기" 링크 (AC-T5 · Q2-a seam)', () => {
  it('세 약관 행 각각에 "보기" 요소가 렌더된다', () => {
    render(<TermsScreenNext {...makeProps()} />);

    ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'MARKETING'].forEach((termsType) => {
      expect(
        screen.getByTestId(`onboarding-terms-view-${termsType}`)
      ).toBeOnTheScreen();
    });
  });

  it('"보기"를 탭하면 onViewTerms 가 그 행의 termsType 으로 1회 호출되고, 행 토글로 새지 않는다', () => {
    const onViewTerms = jest.fn();
    const onToggle = jest.fn();
    render(
      <TermsScreenNext {...makeProps({ onToggle })} onViewTerms={onViewTerms} />
    );

    fireEvent.press(screen.getByTestId('onboarding-terms-view-PRIVACY_POLICY'));

    expect(onViewTerms).toHaveBeenCalledTimes(1);
    expect(onViewTerms).toHaveBeenCalledWith('PRIVACY_POLICY');
    // "보기" 탭이 체크박스 행 press 로 전파되면 동의 상태가 바뀌어 버린다 — 절대 금지.
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('onViewTerms 미전달이면 "보기"를 탭해도 크래시 없이 아무 일도 일어나지 않는다', () => {
    const onToggle = jest.fn();
    render(<TermsScreenNext {...makeProps({ onToggle })} />);

    // optional prop 이므로 press 자체가 예외 없이 지나가야 한다(지나가지 못하면 테스트가 실패한다).
    fireEvent.press(screen.getByTestId('onboarding-terms-view-MARKETING'));

    expect(onToggle).not.toHaveBeenCalled();
  });
});
