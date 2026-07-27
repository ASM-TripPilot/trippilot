import { fireEvent, render, screen } from '@testing-library/react-native';

import { PrefStep2Screen, type PrefStep2ScreenProps } from './PrefStep2Screen';

/**
 * AC2 · US-ONB-06(예산 단일)·07(동행 복수)·10(음식 복수)·09(이동 복수)·11(탈출구) —
 * 취향 2/2 화면 프레젠테이션.
 *
 * 무엇을 보장하나: Figma c09b 그대로 예산 4구간(단일)·동행 4항목(복수, Q3)·음식칩
 * 5항목(복수)·이동 3항목(복수, Q3)을 그리고, 2/2에만 있는 back chevron이 콜백을 부르며,
 * CTA('완료')는 0개 선택에도 항상 활성이다.
 *
 * 3동작: 준비(props 픽스처) → 실행(렌더/탭) → 단언(무엇이 보이고 무엇이 호출되는가).
 */

const BUDGET_SLUGS = ['low', 'mid', 'high', 'luxury'] as const;
const COMPANION_SLUGS = ['solo', 'friends', 'couple', 'family'] as const;
const FOOD_SLUGS = ['hotspot', 'local', 'seafood', 'spicy', 'any'] as const;
const TRANSPORT_SLUGS = ['walk', 'transit', 'car'] as const;

function makeProps(
  overrides: Partial<PrefStep2ScreenProps> = {}
): PrefStep2ScreenProps {
  return {
    selectedBudget: null,
    selectedCompanions: null,
    selectedFoods: null,
    selectedTransports: null,
    onToggleBudget: jest.fn(),
    onToggleCompanion: jest.fn(),
    onToggleFood: jest.fn(),
    onToggleTransport: jest.fn(),
    onBack: jest.fn(),
    onDone: jest.fn(),
    onSkipAll: jest.fn(),
    ...overrides,
  };
}

describe('PrefStep2Screen — 예산 (AC2 · US-ONB-06 · 4-1)', () => {
  it('4구간이 렌더되고 단일 선택만 표시되며 탭하면 그 slug로 콜백이 호출된다', () => {
    // 준비 — 'mid'가 이미 선택된 상태.
    const props = makeProps({ selectedBudget: 'mid' });
    render(<PrefStep2Screen {...props} />);

    // 단언(존재) — 4구간 전부.
    BUDGET_SLUGS.forEach((slug) => {
      expect(
        screen.getByTestId(`onboarding-pref2-budget-${slug}`)
      ).toBeOnTheScreen();
    });
    // 단언(선택 표시) — mid만 selected(단일 선택 증명).
    expect(screen.getByTestId('onboarding-pref2-budget-mid')).toBeSelected();

    // 실행 — 'low' 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-budget-low'));

    // 단언(콜백) — onToggleBudget('low').
    expect(props.onToggleBudget).toHaveBeenCalledWith('low');
  });
});

describe('PrefStep2Screen — 동행 (AC2 · US-ONB-07 · Q3 복수 · 4-2)', () => {
  it('4항목이 렌더되고 복수 선택이 동시에 표시되며 탭하면 콜백이 호출된다', () => {
    // 준비 — solo·friends 둘 다 선택된 상태(복수 증명).
    const props = makeProps({ selectedCompanions: ['solo', 'friends'] });
    render(<PrefStep2Screen {...props} />);

    // 단언(존재) — 4항목 전부.
    COMPANION_SLUGS.forEach((slug) => {
      expect(
        screen.getByTestId(`onboarding-pref2-companion-${slug}`)
      ).toBeOnTheScreen();
    });
    // 단언(복수 선택) — 둘 다 selected(Q3: 단일이 아니라 복수라는 증거).
    expect(
      screen.getByTestId('onboarding-pref2-companion-solo')
    ).toBeSelected();
    expect(
      screen.getByTestId('onboarding-pref2-companion-friends')
    ).toBeSelected();

    // 실행 — 'couple' 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-companion-couple'));

    // 단언(콜백).
    expect(props.onToggleCompanion).toHaveBeenCalledWith('couple');
  });
});

describe('PrefStep2Screen — 음식 (AC2 · US-ONB-10 · 4-3)', () => {
  it('칩 5개가 렌더되고 복수 선택이 동시에 표시되며 탭하면 콜백이 호출된다', () => {
    // 준비 — hotspot·seafood 둘 다 선택.
    const props = makeProps({ selectedFoods: ['hotspot', 'seafood'] });
    render(<PrefStep2Screen {...props} />);

    // 단언(존재) — 5칩 전부.
    FOOD_SLUGS.forEach((slug) => {
      expect(
        screen.getByTestId(`onboarding-pref2-food-${slug}`)
      ).toBeOnTheScreen();
    });
    // 단언(복수 선택).
    expect(screen.getByTestId('onboarding-pref2-food-hotspot')).toBeSelected();
    expect(screen.getByTestId('onboarding-pref2-food-seafood')).toBeSelected();

    // 실행 — 'spicy' 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-food-spicy'));

    // 단언(콜백).
    expect(props.onToggleFood).toHaveBeenCalledWith('spicy');
  });
});

describe('PrefStep2Screen — 이동 (AC2 · US-ONB-09 · Q3 복수 · 4-4)', () => {
  it('3항목이 렌더되고 복수 선택이 동시에 표시되며 탭하면 콜백이 호출된다', () => {
    // 준비 — walk·transit 둘 다 선택.
    const props = makeProps({ selectedTransports: ['walk', 'transit'] });
    render(<PrefStep2Screen {...props} />);

    // 단언(존재) — 3항목 전부.
    TRANSPORT_SLUGS.forEach((slug) => {
      expect(
        screen.getByTestId(`onboarding-pref2-transport-${slug}`)
      ).toBeOnTheScreen();
    });
    // 단언(복수 선택) — Q3 확정: 이동도 복수다.
    expect(
      screen.getByTestId('onboarding-pref2-transport-walk')
    ).toBeSelected();
    expect(
      screen.getByTestId('onboarding-pref2-transport-transit')
    ).toBeSelected();

    // 실행 — 'car' 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-transport-car'));

    // 단언(콜백).
    expect(props.onToggleTransport).toHaveBeenCalledWith('car');
  });
});

describe('PrefStep2Screen — 크롬(back·skip) (AC2 · US-ONB-11 · Q4 · 4-5)', () => {
  it('2/2 전용 back chevron이 존재하고 상·하단 skip과 함께 콜백을 부른다', () => {
    // 준비 — 콜백 관찰(back·skipAll).
    const onBack = jest.fn();
    const onSkipAll = jest.fn();
    render(<PrefStep2Screen {...makeProps({ onBack, onSkipAll })} />);

    // 실행 — back 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-back'));
    // 단언 — 1/2와 대비되게 2/2에는 back이 존재하고 onBack이 불린다(Q4).
    expect(onBack).toHaveBeenCalled();

    // 실행 — 상·하단 skip 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-skip-top'));
    fireEvent.press(screen.getByTestId('onboarding-pref2-skip-bottom'));

    // 단언 — 상·하단이 같은 동작을 2회 호출.
    expect(onSkipAll).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('나중에 설정하고 시작')).toHaveLength(2);
  });
});

describe('PrefStep2Screen — 완료 항상 활성 + 문구 (AC2 · 인터뷰4 · 4-6)', () => {
  it('전 축 미선택이어도 완료 버튼은 활성이고 탭하면 onDone이 호출된다', () => {
    // 준비 — 전 축 null + onDone 관찰.
    const onDone = jest.fn();
    render(<PrefStep2Screen {...makeProps({ onDone })} />);

    // 단언 — 핵심 문구·스텝번호·info.
    expect(screen.getByText('조금만 더 알려주세요')).toBeOnTheScreen();
    expect(screen.getByText('2/2')).toBeOnTheScreen();
    expect(screen.getByTestId('onboarding-pref2-info')).toBeOnTheScreen();

    // 단언 — CTA 활성(인터뷰4: 0개 선택에도 항상 활성).
    expect(screen.getByTestId('onboarding-pref2-done')).toBeEnabled();

    // 실행 — CTA 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-done'));

    // 단언 — onDone 호출.
    expect(onDone).toHaveBeenCalled();
  });
});
