import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

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

/**
 * TRIP-1023 #002 (결정2 · US-ONB-02 예외 · BR-U0-10) — 미동의 안내는 '다음'을 시도했을 때만.
 *
 * 무엇을 보장하나: 첫 진입엔 빨간 안내가 없고, 비활성으로 보이는 '다음'을 탭해야 안내가 뜬다.
 * '다음'은 접근성상 disabled 로 알리되 탭은 받아야 한다 — Pressable 의 disabled prop 은 탭을 삼키므로
 * (02a ★1) 그 prop 으로 막는 구현은 T-A11 을 통과할 수 없다. 한 번 뜬 안내는 화면에 머무는 동안
 * 유지되고 목록만 props 를 따라 준다(Q7).
 */
const ALL_MISSING = [
  LABELS.TERMS_OF_SERVICE,
  LABELS.PRIVACY_POLICY,
  LABELS.LOCATION_TERMS,
];
const MISSING_NOTICE = '아직 동의하지 않은 필수 항목이에요';

/** 실제 첫 진입과 같은 값 — 훅은 약관이 도착하면 곧바로 미동의 3종을 준다. */
function firstEntryProps(
  overrides: Partial<TermsScreenProps> = {}
): TermsScreenProps {
  return makeProps({
    canProceed: false,
    missingRequiredLabels: ALL_MISSING,
    ...overrides,
  });
}

function checkedWhere(
  predicate: (termsType: string) => boolean
): TermsScreenProps['items'] {
  return makeProps().items.map((item) => ({
    ...item,
    checked: predicate(item.termsType),
  }));
}

describe('🔴 TRIP-1023 #002 — 첫 진입엔 미동의 안내가 없다 (AC-A10)', () => {
  it('미동의 3종이 넘어와도 렌더만으로는 안내가 없고, 다음은 접근성상 비활성이다', () => {
    render(<TermsScreen {...firstEntryProps()} />);

    // 긍정 앵커 — 화면과 행이 실제로 그려졌다.
    expect(screen.getByTestId('onboarding-terms-root')).toBeOnTheScreen();
    expect(
      screen.getByTestId('onboarding-terms-TERMS_OF_SERVICE')
    ).toBeOnTheScreen();

    expect(screen.queryByTestId('onboarding-terms-missing')).toBeNull();
    expect(screen.queryByText(MISSING_NOTICE)).toBeNull();
    expect(screen.getByTestId('onboarding-terms-next')).toBeDisabled();
  });
});

// AC A2(미동의 이름 안내)도 이 describe 와 아래 A12 가 본다 — 옛 A2 it 둘은 같은 결함을 잡아 지웠다.
describe('🔴 TRIP-1023 #002 — 비활성 다음을 탭하면 안내가 뜬다 (AC-A11)', () => {
  it('탭 전엔 없던 안내와 세 항목 이름이 탭 뒤에 나타나고, onNext 는 부르지 않는다', () => {
    const onNext = jest.fn();
    render(<TermsScreen {...firstEntryProps({ onNext })} />);

    // "아직 없다" 앵커 — 이게 없으면 처음부터 떠 있는 구현도 통과한다.
    expect(screen.queryByTestId('onboarding-terms-missing')).toBeNull();

    fireEvent.press(screen.getByTestId('onboarding-terms-next'));

    expect(screen.getByText(MISSING_NOTICE)).toBeOnTheScreen();
    const missing = screen.getByTestId('onboarding-terms-missing');
    expect(missing).toHaveTextContent(/서비스 이용약관/);
    expect(missing).toHaveTextContent(/개인정보 수집·이용/);
    expect(missing).toHaveTextContent(/위치기반서비스/);
    // 비활성 탭은 진행 의도가 아니다 — 상위(저장·라우팅)로 올라가지 않는다.
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByTestId('onboarding-terms-next')).toBeDisabled();
  });
});

describe('🔴 TRIP-1023 #002 — 뜬 안내는 목록만 실시간으로 준다 (AC-A12 · Q7)', () => {
  it('체크할수록 이름이 줄고, 전부 체크면 사라지고, 하나를 풀면 다음을 다시 안 눌러도 돌아온다', () => {
    render(<TermsScreen {...firstEntryProps()} />);
    expect(screen.queryByTestId('onboarding-terms-missing')).toBeNull();
    fireEvent.press(screen.getByTestId('onboarding-terms-next'));

    // 서비스 이용약관 체크 → 남은 두 이름만.
    screen.rerender(
      <TermsScreen
        {...firstEntryProps({
          items: checkedWhere((type) => type === 'TERMS_OF_SERVICE'),
          missingRequiredLabels: [LABELS.PRIVACY_POLICY, LABELS.LOCATION_TERMS],
        })}
      />
    );
    expect(
      screen.getByTestId('onboarding-terms-missing')
    ).not.toHaveTextContent(/서비스 이용약관/);
    expect(screen.getByTestId('onboarding-terms-missing')).toHaveTextContent(
      /개인정보 수집·이용/
    );

    // 전부 체크 → 안내가 사라지고 다음이 열린다.
    screen.rerender(
      <TermsScreen
        {...makeProps({
          items: checkedWhere(() => true),
          allChecked: true,
          canProceed: true,
          missingRequiredLabels: [],
        })}
      />
    );
    expect(screen.queryByTestId('onboarding-terms-missing')).toBeNull();
    expect(screen.getByTestId('onboarding-terms-next')).toBeEnabled();

    // 위치만 다시 해제 → '다음'을 또 누르지 않아도 안내가 곧바로 돌아온다(Q7).
    screen.rerender(
      <TermsScreen
        {...firstEntryProps({
          items: checkedWhere((type) => type !== 'LOCATION_TERMS'),
          missingRequiredLabels: [LABELS.LOCATION_TERMS],
        })}
      />
    );
    expect(screen.getByTestId('onboarding-terms-missing')).toHaveTextContent(
      /위치기반서비스/
    );
  });
});

describe('TRIP-1023 #002 — 활성 다음은 그대로 진행한다 (AC-A14 화면측 · 선제 green)', () => {
  it('전부 동의 상태에서 다음을 누르면 onNext 가 정확히 1회 불리고 안내는 없다', () => {
    const onNext = jest.fn();
    render(
      <TermsScreen
        {...makeProps({
          items: checkedWhere(() => true),
          allChecked: true,
          canProceed: true,
          missingRequiredLabels: [],
          onNext,
        })}
      />
    );

    fireEvent.press(screen.getByTestId('onboarding-terms-next'));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('onboarding-terms-missing')).toBeNull();
  });
});

/**
 * TRIP-1023 #005 (결정1 · US-ONB-11) — 온보딩은 앞으로만. 눌리지 않는 뒤로 셰브론을 머리에서 뺀다.
 *
 * 글리프는 컴포넌트 이름으로 찾는다(02a ★5) — `BackChevronGlyph`·`LocationBackChevronGlyph` 를
 * 한 정규식으로 잡고, 테스트가 글리프 export 에 묶이지 않는다.
 */
function backChevronCount(): number {
  return screen.UNSAFE_root.findAll(
    (node) =>
      typeof node.type === 'function' &&
      /BackChevron/.test((node.type as { name?: string }).name ?? '')
  ).length;
}

describe('🔴 TRIP-1023 #005 — 약관 머리에 뒤로 글리프가 없다 (AC-A4 · AC-A5)', () => {
  it('제목 "약관 동의"는 남고, 뒤로 셰브론과 뒤로 역할 요소는 없다', () => {
    render(<TermsScreen {...makeProps()} />);

    expect(screen.getByTestId('onboarding-terms-root')).toBeOnTheScreen();
    expect(screen.getByText('약관 동의')).toBeOnTheScreen();

    expect(backChevronCount()).toBe(0);
    expect(screen.queryAllByTestId(/back/).length).toBe(0);
  });
});

/**
 * 비주얼 구조 가드 — 옛 TermsScreen.visual.test.tsx (c06-terms Figma 정합 1293:1208 · TRIP-162·592).
 *
 * 픽셀(배지 색·radius·hairline)은 [검증] 단계의 Figma 스크린샷 대조 몫이다. 여기서는 신규 요소가
 * '존재'하고 seam 콜백이 계약대로 호출되는지, 배지 위계 토큰만 본다. 픽스처는 위 makeProps 와 달리
 * **선택 행(MARKETING)** 이 섞인 3행이다 — 필수/선택 배지 파생(AC-T1)·선택 배지 토큰을 보려면 선택 행이
 * 있어야 한다(위 BR-U0-10 it 은 필수 3종만 그린다는 반대 방향 계약이라 둘 다 남는다).
 */
describe('비주얼 구조', () => {
  // 선택 행(MARKETING)이 섞인 픽스처 — 위 makeProps 는 필수 3종뿐이라 선택 배지를 못 그린다.
  function makeMixedProps(
    overrides: Partial<TermsScreenProps> = {}
  ): TermsScreenProps {
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

  describe('TermsScreen — 필수/선택 배지 (AC-T1)', () => {
    it('필수 행에는 "필수" 배지, 선택 행에는 "선택" 배지가 item.required 로 파생돼 렌더된다', () => {
      render(<TermsScreen {...makeMixedProps()} />);

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

  // 렌더된 노드의 className 을 공백으로 쪼갠 '토큰 배열'로 만든다. 배열 원소 일치(includes)로만
  // 비교한다 — 'text-primary-text'.includes('text-primary')는 문자열이면 true(오탐)지만 토큰 배열
  // ['text-primary-text']에 'text-primary'는 원소로 없다(SocialLoginScreen.test.tsx `비주얼 구조` §D5 와 동일
  // 근거, 02a §5 실측: ['text-primary-text'].includes('text-primary')===false).
  function classTokens(node: { props?: { className?: unknown } }): string[] {
    const cn = node.props?.className;
    return typeof cn === 'string' ? cn.trim().split(/\s+/).filter(Boolean) : [];
  }

  // TRIP-592: '필수'/'선택' 배지가 파스텔 pill 채움을 잃고 형태(solid 텍스트)로 위계를 신호한다.
  // testID(onboarding-terms-badge-{type})와 텍스트 자체는 AC-T1·위 BR-U0-10 it 이 이미 잠갔다 — 여기서는
  // pill 채움의 '부재'와 solid 색 토큰의 '존재'만 추가로 잠근다. testID 앵커는 절대 보존된다(01b ★2).
  describe('TermsScreen — 배지 위계 전환: pill 폐기·solid 텍스트 (AC-②-1 · AC-②-3, TRIP-592)', () => {
    it('필수 배지가 pill 채움(bg-primary-pale) 없이 text-primary solid 텍스트(text-label)를 쓴다', () => {
      render(<TermsScreen {...makeMixedProps()} />);

      // ▸실행 — testID 는 배지 래퍼(View)에, '필수' 텍스트는 그 안 Text 노드에 있다(02a §5 실측).
      const badge = screen.getByTestId(
        'onboarding-terms-badge-TERMS_OF_SERVICE'
      );
      const label = within(badge).getByText('필수');

      // ▸단언 — 래퍼: pill 채움 폐기. 텍스트: 코랄 solid(text-primary) 채택 + 옛 색(text-primary-text)·
      // 옛 크기(text-micro) 폐기. text-primary 와 text-primary-text 는 서로 다른 토큰이라 겹오탐이 없다.
      expect({
        wrapperNoPaleFill: classTokens(badge).includes('bg-primary-pale'),
        textCoral: classTokens(label).includes('text-primary'),
        textNoOldColor: classTokens(label).includes('text-primary-text'),
        textSize: classTokens(label).includes('text-label'),
        textNoOldSize: classTokens(label).includes('text-micro'),
      }).toEqual({
        wrapperNoPaleFill: false,
        textCoral: true,
        textNoOldColor: false,
        textSize: true,
        textNoOldSize: false,
      });
    });

    it('선택 배지가 pill 채움(bg-surface-strong) 없이 text-muted solid 텍스트를 쓴다', () => {
      render(<TermsScreen {...makeMixedProps()} />);

      const badge = screen.getByTestId('onboarding-terms-badge-MARKETING');
      const label = within(badge).getByText('선택');

      // ▸단언 — 래퍼: 뉴트럴 pill 채움 폐기. 텍스트: '필수'(코랄)와 일관되게 solid 뉴트럴(text-muted).
      expect({
        wrapperNoStrongFill: classTokens(badge).includes('bg-surface-strong'),
        textMuted: classTokens(label).includes('text-muted'),
      }).toEqual({
        wrapperNoStrongFill: false,
        textMuted: true,
      });
    });
  });

  describe('TermsScreen — "보기" 링크 (AC-T5 · Q2-a seam)', () => {
    it('세 약관 행 각각에 "보기" 요소가 렌더된다', () => {
      render(<TermsScreen {...makeMixedProps()} />);

      ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'MARKETING'].forEach(
        (termsType) => {
          expect(
            screen.getByTestId(`onboarding-terms-view-${termsType}`)
          ).toBeOnTheScreen();
        }
      );
    });

    it('"보기"를 탭하면 onViewTerms 가 그 행의 termsType 으로 1회 호출되고, 행 토글로 새지 않는다', () => {
      const onViewTerms = jest.fn();
      const onToggle = jest.fn();
      render(
        <TermsScreen
          {...makeMixedProps({ onToggle })}
          onViewTerms={onViewTerms}
        />
      );

      fireEvent.press(
        screen.getByTestId('onboarding-terms-view-PRIVACY_POLICY')
      );

      expect(onViewTerms).toHaveBeenCalledTimes(1);
      expect(onViewTerms).toHaveBeenCalledWith('PRIVACY_POLICY');
      // "보기" 탭이 체크박스 행 press 로 전파되면 동의 상태가 바뀌어 버린다 — 절대 금지.
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('onViewTerms 미전달이면 "보기"를 탭해도 크래시 없이 아무 일도 일어나지 않는다', () => {
      const onToggle = jest.fn();
      render(<TermsScreen {...makeMixedProps({ onToggle })} />);

      // optional prop 이므로 press 자체가 예외 없이 지나가야 한다(지나가지 못하면 테스트가 실패한다).
      fireEvent.press(screen.getByTestId('onboarding-terms-view-MARKETING'));

      expect(onToggle).not.toHaveBeenCalled();
    });
  });
});
