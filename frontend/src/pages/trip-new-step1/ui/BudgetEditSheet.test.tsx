import { Keyboard } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { BudgetEditSheet } from './BudgetEditSheet';

/**
 * TRIP-670 g01 예산 편집 바텀시트 — **props-only 무상태 프레젠테이션**(01b D4).
 *
 * 무엇을 보장하나: 시트가 넘겨받은 `amountText`·`tier`(드래프트, 배선 소유)로 ① tier 세그 4칩·금액
 * 필드(₩·input·원)·수정·안내·적용을 그리고 ② 선택 tier 칩만 **서로 다른 활성 표식 testID**로 구분하며
 * ③ 안내 range 를 활성 tier 에서 도출해 갱신하고 ④ **tier 선택은 금액을 안 건드리며**(★ tier=순수 표시)
 * ⑤ 금액 입력·수정·적용 press 를 콜백으로 정확히 올린다. 이 시트는 **상태를 안 가진다** — 드래프트는
 * 배선(TripNewStep1Page)이 소유하고, 시트는 완성형 props 를 받아 그릴 뿐이다.
 *
 * 왜 활성 표식을 색 fill 이 아니라 서로 다른 testID 로 잠그나: 칩 배경색 변화는 jest 렌더 트리에
 * 관찰되지 않는다(repo-traps "글리프/칩 fill 무심판"). 선택 칩만 `-tier-active-{code}` 마커를 렌더해야
 * 뒤바뀜·교차가 red 로 잡힌다(S4 companion `-chip-active-` 선례).
 *
 * ★ tier=순수 표시 계약: tier 칩 press 는 `onSelectTier` 만 부르고 `onChangeAmount` 를 **안 부른다**
 * (tier 가 금액을 안 건드림 — 대표값 발명 금지, 01b D1). 안내 range 는 활성 tier 를 따라 갱신된다
 * (Figma 가 "50~150만"만 명시했으므로 그것을 tier 무관 하드코딩하면 '고급' 케이스에서 red, 01b D2).
 *
 * 무엇을 **못** 보나(6-b 실기 전용): `__mocks__/@gorhom/bottom-sheet.tsx`가 통과형 목이라(마운트하면
 * children 무조건 렌더) 실제 개폐·딤 전면 커버·중앙정렬·활성 칩 분홍/흰 글자 실렌더는 jest 원리적
 * 사각이다(AC-5). 실검증: 02a §5-1(스크래치 1/1 PASS).
 */

interface SheetPropsForTest {
  amountText: string;
  tier?: string;
  budgetError?: string;
  onChangeAmount: (next: string) => void;
  onBlurAmount: () => void;
  onSelectTier: (tier: string) => void;
  onPressEdit: () => void;
  onApply: () => void;
  onClose: () => void;
  applyDisabled: boolean;
  onboardingTier: string | undefined;
}

function renderSheet(overrides: Partial<SheetPropsForTest> = {}) {
  const spies = {
    onChangeAmount: jest.fn(),
    onBlurAmount: jest.fn(),
    onSelectTier: jest.fn(),
    onPressEdit: jest.fn(),
    onApply: jest.fn(),
    onClose: jest.fn(), // TRIP-683: 딤 바깥 탭 닫힘 콜백(필수 prop 화)
  };
  const props: SheetPropsForTest = {
    amountText: '800,000',
    tier: '중간',
    // TRIP-984: 기본 얼굴 = 온보딩 중간이 금액까지 채운 상태(노트 표시) · 적용 활성.
    onboardingTier: '중간',
    applyDisabled: false,
    ...spies,
    ...overrides,
  };
  render(<BudgetEditSheet {...props} />);
  return spies;
}

describe('AC-1 · tier 세그 4·금액 필드(₩·input·원)·수정·안내·적용 렌더', () => {
  it('시트 컨테이너·tier 칩 4종·금액 입력·₩·원·수정·안내·적용을 그린다', () => {
    renderSheet();

    expect(screen.getByTestId('trip-wizard-budget-sheet')).toBeOnTheScreen();

    // tier 세그 4칩(BUDGET 카탈로그 슬러그 순서)
    for (const code of ['low', 'mid', 'high', 'luxury']) {
      expect(
        screen.getByTestId(`trip-wizard-budget-tier-${code}`)
      ).toBeOnTheScreen();
    }

    // 금액 필드 — ₩ 접두 + 입력 + 원 접미
    expect(screen.getByTestId('trip-wizard-budget-input')).toBeOnTheScreen();
    expect(screen.getByText('₩')).toBeOnTheScreen();
    expect(screen.getByText('원')).toBeOnTheScreen();

    // 수정 · 안내 · 적용
    expect(screen.getByTestId('trip-wizard-budget-edit')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-wizard-budget-note')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-wizard-budget-apply')).toBeOnTheScreen();
  });
});

describe('AC-2 · ★ tier 단일 선택 — 선택 칩만 활성 표식(교차) + 칩 press → onSelectTier', () => {
  it('중간 활성 = mid 표식만, 나머지 3종 부재 + 칩 press → onSelectTier(한국어값)', () => {
    const spies = renderSheet({ tier: '중간' });

    // 활성 표식은 선택 칩에만(색 fill 아님 — 서로 다른 testID).
    expect(
      screen.getByTestId('trip-wizard-budget-tier-active-mid')
    ).toBeOnTheScreen();
    // 교차 부재 — 나머지 3종엔 활성 표식이 없다(교차 뮤턴트가 여기서 red).
    for (const code of ['low', 'high', 'luxury']) {
      expect(
        screen.queryByTestId(`trip-wizard-budget-tier-active-${code}`)
      ).toBeNull();
    }

    // 칩 press → 해당 tier 한국어값으로 콜백(code=high → '고급').
    fireEvent.press(screen.getByTestId('trip-wizard-budget-tier-high'));
    expect(spies.onSelectTier).toHaveBeenCalledWith('고급');
  });

  it('미선택(tier undefined) = 활성 표식 4개 전부 부재', () => {
    renderSheet({ tier: undefined });

    for (const code of ['low', 'mid', 'high', 'luxury']) {
      expect(
        screen.queryByTestId(`trip-wizard-budget-tier-active-${code}`)
      ).toBeNull();
    }
  });
});

describe('AC-2b · 노트 range 는 온보딩 tier 를 따른다 (하드코딩 red, TRIP-984 D10 로 조건 이관)', () => {
  it('온보딩=현재=중간 → "50~150만", 온보딩=현재=고급 → "150~300만"(중간 문구 부재)', () => {
    renderSheet({ onboardingTier: '중간', tier: '중간' });
    // TRIP-739: 굽은 작은따옴표(‘ ’, U+2018/U+2019)로 감싼 전체 문구를 완전일치로 잠근다 — 직선 '(U+0027)로
    // 되돌리면 red(Figma 3647:2068 정합).
    expect(
      screen.getByText('온보딩에서 고른 ‘중간(50~150만)’ 범위로 채웠어요')
    ).toBeOnTheScreen();

    screen.rerender(
      <BudgetEditSheet
        amountText="800,000"
        tier="고급"
        onboardingTier="고급"
        applyDisabled={false}
        onChangeAmount={jest.fn()}
        onBlurAmount={jest.fn()}
        onSelectTier={jest.fn()}
        onPressEdit={jest.fn()}
        onApply={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(
      screen.getByText('온보딩에서 고른 ‘고급(150~300만)’ 범위로 채웠어요')
    ).toBeOnTheScreen();
    expect(
      screen.queryByText('온보딩에서 고른 ‘중간(50~150만)’ 범위로 채웠어요')
    ).toBeNull();
  });
});

describe('AC-2c · ★ tier press 는 금액을 안 건드린다 (대표값 발명 금지)', () => {
  it('럭셔리 칩을 눌러도 onSelectTier 만 부르고 onChangeAmount 는 0회', () => {
    const spies = renderSheet({ amountText: '800,000', tier: '중간' });

    fireEvent.press(screen.getByTestId('trip-wizard-budget-tier-luxury'));

    expect(spies.onSelectTier).toHaveBeenCalledWith('럭셔리');
    // tier 가 금액을 자동으로 채우는 뮤턴트면 여기서 red.
    expect(spies.onChangeAmount).not.toHaveBeenCalled();
  });
});

describe('AC-3 · 금액 입력 배선 + 수정', () => {
  it('입력이 amountText 를 표시하고, 타이핑이 onChangeAmount 로, 수정이 onPressEdit 로 간다', () => {
    const spies = renderSheet({ amountText: '800,000' });

    const input = screen.getByTestId('trip-wizard-budget-input');
    // 콤마 포함 완전일치(02a §5-1 실측 — toHaveDisplayValue).
    expect(input).toHaveDisplayValue('800,000');

    fireEvent.changeText(input, '500000');
    expect(spies.onChangeAmount).toHaveBeenCalledWith('500000');

    fireEvent.press(screen.getByTestId('trip-wizard-budget-edit'));
    expect(spies.onPressEdit).toHaveBeenCalledTimes(1);
  });
});

describe('AC-4 · 적용 → onApply 만 (편집 콜백 없음)', () => {
  it('"적용" press 가 onApply 를 한 번 부르고 편집 콜백은 안 부른다 (커밋은 배선 몫)', () => {
    const spies = renderSheet({ amountText: '800,000', tier: '중간' });

    fireEvent.press(screen.getByTestId('trip-wizard-budget-apply'));

    expect(spies.onApply).toHaveBeenCalledTimes(1);
    // 적용은 커밋 신호일 뿐 — 시트가 편집 콜백을 다시 부르지 않는다.
    expect(spies.onChangeAmount).not.toHaveBeenCalled();
    expect(spies.onSelectTier).not.toHaveBeenCalled();
  });
});

/**
 * TRIP-677 · S6E budgetError 슬롯 계약(선제green 앵커). 시트는 props-only 라 `amountText` 로 오류를
 * **도출하지 않는다** — 페이지가 `parseBudgetAmount(draft).kind==='invalid'` 를 도출해 `budgetError` 로
 * 내려주면 그것을 그릴 뿐이다(도출 red 는 페이지 통합 `budgetSheet.integration` 의 AC-S6E-1 에 있다).
 * 이 컴포넌트 테스트는 페이지가 의존하는 그 슬롯 계약을 못 박는다 — 슬롯이 이미 있어 지금도 green.
 */
describe('AC-S6E-1(슬롯) · budgetError prop 을 받으면 오류 노드를 그리고, 없으면 안 그린다', () => {
  it('budgetError 가 있으면 trip-wizard-error-budget 에 문구를 그린다', () => {
    renderSheet({ budgetError: '숫자만 입력해 주세요' });

    const node = screen.getByTestId('trip-wizard-error-budget');
    expect(node).toBeOnTheScreen();
    // 노드 전체 내용이 곧 이 문구라 완전일치 안전(02a §5-E, RNTL 완전일치 함정 회피).
    expect(node).toHaveTextContent('숫자만 입력해 주세요');
  });

  it('budgetError 가 없으면 오류 노드를 그리지 않는다 (부정 짝)', () => {
    renderSheet();

    expect(screen.queryByTestId('trip-wizard-error-budget')).toBeNull();
  });
});

/**
 * TRIP-984 D10 · 예산 노트 "온보딩에서 고른 …" 은 온보딩 tier 가 있고(배선이 금액 프리필까지 확인해 내림)
 * 현재 tier 가 그것과 같을 때만 그린다. 부재 단언은 시트 존재와 짝이다(시트가 안 떠도 null 은 참).
 */
describe('AC-C1·C3 · 노트는 온보딩 tier 가 있고 현재 tier 와 같을 때만', () => {
  it('C1 · 온보딩 tier 가 없으면 tier 를 골라 둬도 노트가 없다', () => {
    renderSheet({ onboardingTier: undefined, tier: '중간' });

    expect(screen.getByTestId('trip-wizard-budget-sheet')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-budget-note')).toBeNull();
    expect(screen.queryByText(/온보딩/)).toBeNull();
  });

  it('C3 · 온보딩은 중간인데 현재 고급이면 노트가 없다 ("온보딩에서 고른 ‘고급…’" 거짓 금지)', () => {
    renderSheet({ onboardingTier: '중간', tier: '고급' });

    expect(screen.getByTestId('trip-wizard-budget-sheet')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-budget-note')).toBeNull();
    expect(screen.queryByText(/온보딩/)).toBeNull();
  });
});

/**
 * TRIP-984 D8 · 적용 비활성 표면(PeriodEditSheet 선례). 판정은 배선이 `applyDisabled` 로 내린다(D4 무상태).
 * `toBeDisabled` 는 accessibilityState 만 읽으므로 press 결과(onApply 0회)와 짝으로 둔다.
 */
describe('AC-A · applyDisabled → 진짜 disabled + opacity-40', () => {
  it('applyDisabled=true 면 적용이 비활성이고, 눌러도 onApply 가 불리지 않는다', () => {
    const spies = renderSheet({ amountText: '', applyDisabled: true });

    const apply = screen.getByTestId('trip-wizard-budget-apply');
    expect(apply).toBeDisabled();
    expect(String(apply.props.className).split(/\s+/)).toContain('opacity-40');

    fireEvent.press(apply);
    expect(spies.onApply).not.toHaveBeenCalled();
  });

  it('applyDisabled=false 면 활성이고(opacity-40 없음) press → onApply 1회 (짝)', () => {
    const spies = renderSheet({ applyDisabled: false });

    const apply = screen.getByTestId('trip-wizard-budget-apply');
    expect(apply).not.toBeDisabled();
    expect(String(apply.props.className).split(/\s+/)).not.toContain(
      'opacity-40'
    );

    fireEvent.press(apply);
    expect(spies.onApply).toHaveBeenCalledTimes(1);
  });
});

/**
 * TRIP-984 D9 · 키보드 처방. 실제로 시트가 키보드만큼 올라가는지는 통과형 목이라 jest 사각(6-b) —
 * 여기선 "BottomSheetTextInput 을 썼다 · keyboardBehavior 를 적었다 · 본문 탭이 Keyboard.dismiss 를
 * 부른다"까지만 잠근다. 목의 BottomSheetTextInput 은 TextInput 과 다른 타입이라 플레인 회귀가 구분된다.
 */
describe('AC-B · 키보드 처방 (BottomSheetTextInput · keyboardBehavior · 본문 탭 dismiss)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('B1 · 금액 입력칸은 BottomSheetTextInput 이다 (플레인 TextInput 이면 red)', () => {
    renderSheet();

    expect(screen.UNSAFE_getByType(BottomSheetTextInput).props.testID).toBe(
      'trip-wizard-budget-input'
    );
  });

  it('B2 · 시트가 keyboardBehavior="interactive" 를 명시한다', () => {
    renderSheet();

    expect(
      screen.UNSAFE_queryAllByProps({ keyboardBehavior: 'interactive' })
    ).not.toHaveLength(0);
  });

  it('B3 · 칩·수정은 제 콜백만 부르고, 본문 빈 곳(부제 글자) 탭은 Keyboard.dismiss 를 부른다', () => {
    // 렌더 전에 건다 — onPress={Keyboard.dismiss} 처럼 참조를 렌더 때 잡는 구현도 스파이가 본다.
    const dismiss = jest
      .spyOn(Keyboard, 'dismiss')
      .mockImplementation(() => {});
    const spies = renderSheet();

    fireEvent.press(screen.getByTestId('trip-wizard-budget-tier-mid'));
    expect(spies.onSelectTier).toHaveBeenCalledWith('중간');
    expect(dismiss).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('trip-wizard-budget-edit'));
    expect(spies.onPressEdit).toHaveBeenCalledTimes(1);
    expect(dismiss).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('1인 총액 기준이에요'));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
