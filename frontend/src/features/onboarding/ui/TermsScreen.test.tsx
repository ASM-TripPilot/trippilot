import { render, screen } from '@testing-library/react-native';

import { TermsScreen, type TermsScreenProps } from './TermsScreen';

/**
 * AC A1 · A2 · A8(표시) · C6 — c06-terms 프레젠테이션 계약 (BR-U0-10 정합, TRIP-366).
 *
 * 무엇을 보장하나: 넘겨받은 상태를 화면이 **틀리지 않게 그리는가**. 어떤 약관을 그릴지 고르는 규칙
 * (6종 → 필수 3종 필터)은 컨테이너 통합테스트가 맡는다 — 여기서 중복 검증하지 않는다.
 *
 * 3동작: 준비(props 로 화면 상태를 세운다) → 실행(렌더) → 단언(무엇이 보이고 무엇이 잠겼는가).
 *
 * *(개념)* `toBeDisabled()` = 그 요소가 눌리지 않는 상태인지 보는 matcher(RNTL 내장).
 * `toBeChecked()` = 체크박스 역할 요소의 체크 여부를 보는 matcher — 둘 다 접근성 속성을 읽으므로
 * 구현이 접근성 정보를 제대로 달아야 통과한다(스크린리더 사용자에게도 같은 정보가 전달된다).
 */

// BR-U0-10 정본 문구(TRIP-366 결정1 — 서버 body 의 [플레이스홀더] 임시값 대신 BR 문구를 라벨로).
const LABELS = {
  TERMS_OF_SERVICE: '서비스 이용약관',
  PRIVACY_POLICY: '개인정보 수집·이용',
  LOCATION_TERMS: '위치기반서비스',
};

function makeProps(
  overrides: Partial<TermsScreenProps> = {}
): TermsScreenProps {
  return {
    // BR-U0-10 — U0 온보딩은 필수 3종만 그린다. 셋 다 required=true(선택 항목 없음).
    items: [
      {
        termsType: 'TERMS_OF_SERVICE',
        version: '1.4',
        label: LABELS.TERMS_OF_SERVICE,
        required: true,
        checked: false,
      },
      {
        termsType: 'PRIVACY_POLICY',
        version: '2.1',
        label: LABELS.PRIVACY_POLICY,
        required: true,
        checked: false,
      },
      {
        termsType: 'LOCATION_TERMS',
        version: '1.1',
        label: LABELS.LOCATION_TERMS,
        required: true,
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

describe('TermsScreen — 초기 상태 (AC A1)', () => {
  it('아무것도 체크되지 않으면 다음 버튼이 잠기고 필수 3행이 미동의로 표시된다', () => {
    render(<TermsScreen {...makeProps()} />);

    expect(screen.getByTestId('onboarding-terms-next')).toBeDisabled();
    expect(
      screen.getByTestId('onboarding-terms-TERMS_OF_SERVICE')
    ).not.toBeChecked();
    expect(
      screen.getByTestId('onboarding-terms-PRIVACY_POLICY')
    ).not.toBeChecked();
    expect(
      screen.getByTestId('onboarding-terms-LOCATION_TERMS')
    ).not.toBeChecked();
    expect(screen.getByTestId('onboarding-terms-agreeall')).not.toBeChecked();
  });

  it('필수 3종(서비스·개인정보·위치)만 보이고 모두 필수 배지다 — 선택 배지가 없다 (BR-U0-10)', () => {
    render(<TermsScreen {...makeProps()} />);

    expect(screen.getByText(LABELS.TERMS_OF_SERVICE)).toBeOnTheScreen();
    expect(screen.getByText(LABELS.PRIVACY_POLICY)).toBeOnTheScreen();
    expect(screen.getByText(LABELS.LOCATION_TERMS)).toBeOnTheScreen();
    // 세 항목 모두 필수 — 선택 배지가 하나도 없어야 한다(BR-U0-10).
    expect(screen.getAllByText('필수')).toHaveLength(3);
    expect(screen.queryByText('선택')).toBeNull();
  });

  // BR-U0-11 — 마케팅은 U0 온보딩에서 노출하지 않는다(후속 유닛 설정 화면 몫).
  it('마케팅 약관 행을 이 화면에서 노출하지 않는다 (BR-U0-11)', () => {
    render(<TermsScreen {...makeProps()} />);

    expect(screen.getByTestId('onboarding-terms-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-terms-MARKETING')).toBeNull();
    expect(screen.queryByText('마케팅 정보 수신 동의')).toBeNull();
  });
});

describe('TermsScreen — 미동의 안내 (AC A2)', () => {
  it('필수 1종만 체크되면 다음이 잠긴 채 미동의 항목의 이름이 안내된다', () => {
    render(
      <TermsScreen
        {...makeProps({
          items: makeProps().items.map((item) =>
            item.termsType === 'TERMS_OF_SERVICE'
              ? { ...item, checked: true }
              : item
          ),
          canProceed: false,
          missingRequiredLabels: [LABELS.PRIVACY_POLICY, LABELS.LOCATION_TERMS],
        })}
      />
    );

    expect(screen.getByTestId('onboarding-terms-next')).toBeDisabled();
    // "무언가 덜 됐다"가 아니라 **무엇이** 덜 됐는지 이름이 나와야 한다(US-ONB-02 예외 AC).
    // 두 라벨이 ", " 로 이어지므로 regex(부분 일치)로 확인한다 — 이 리포의 toHaveTextContent(문자열)은
    // 기본 exact(전체 일치)라 부분 문자열엔 정규식이 필요하다(matches() exact=true 실측).
    expect(screen.getByTestId('onboarding-terms-missing')).toHaveTextContent(
      /개인정보 수집·이용/
    );
    expect(screen.getByTestId('onboarding-terms-missing')).toHaveTextContent(
      /위치기반서비스/
    );
  });

  it('미동의 항목이 없으면 안내를 띄우지 않고 다음이 열린다', () => {
    render(
      <TermsScreen
        {...makeProps({
          items: makeProps().items.map((item) => ({ ...item, checked: true })),
          canProceed: true,
          missingRequiredLabels: [],
        })}
      />
    );

    expect(screen.getByTestId('onboarding-terms-next')).toBeEnabled();
    expect(screen.queryByTestId('onboarding-terms-missing')).toBeNull();
  });
});

describe('TermsScreen — 저장 실패 표시 (AC A8)', () => {
  it('오류 메시지가 있으면 오류와 재시도 수단을 함께 보여준다 (조용한 실패 금지 · INV-4)', () => {
    render(
      <TermsScreen
        {...makeProps({
          canProceed: true,
          errorMessage: '동의 저장에 실패했어요. 다시 시도해 주세요.',
        })}
      />
    );

    expect(screen.getByTestId('onboarding-terms-error')).toHaveTextContent(
      '동의 저장에 실패했어요. 다시 시도해 주세요.'
    );
    expect(screen.getByTestId('onboarding-terms-retry')).toBeOnTheScreen();
  });
});

describe('TermsScreen — 탈출구 없음 (AC C6 · BR-U0-20)', () => {
  // 부정 단언만 두면 화면이 통째로 비어도 통과한다(가짜 통과).
  // 루트가 그려졌다는 긍정 단언과 짝지어 "그려졌는데 그 안에 없다"를 확인한다.
  it('약관 단계에는 건너뛰기 수단이 존재하지 않는다', () => {
    render(<TermsScreen {...makeProps()} />);

    expect(screen.getByTestId('onboarding-terms-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-terms-skip')).toBeNull();
    expect(screen.queryByText(/건너뛰기|나중에 하기|건너뛰고/)).toBeNull();
  });
});
