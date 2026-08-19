import { fireEvent, render, screen } from '@testing-library/react-native';

import { PrefStep2Screen, type PrefStep2ScreenProps } from './PrefStep2Screen';

/**
 * AC-1(동행 6종)·AC-2(이동 5종)·AC-3(음식 5종)·AC-4(활동 8종 신설)·AC-6(완료 항상 활성)·
 * AC-8(스포츠 부재) — 취향 2/2 화면 프레젠테이션(TRIP-254 정본 정합).
 *
 * 무엇을 보장하나: 예산 4구간(단일, 무변경)은 그대로 두고, 동행·이동·음식 세 축을 정본 값
 * 도메인(US-ONB-07/09/10)으로 교체하고 활동(US-ONB-08) 8종 블록을 신설한다. 라벨(한글)로
 * 존재/부재를 잰다 — 슬러그는 구현 세부다. 부재 단언은 반드시 "새 라벨/블록 존재" 긍정과
 * 같은 it에서 짝지어(대상이 통째로 비어도 초록 통과하는 함정 차단).
 *
 * 3동작: 준비(props 픽스처) → 실행(렌더/탭) → 단언(무엇이 보이고 무엇이 호출되는가).
 *
 * *(개념)* `queryByText(문자열)`은 그 문자열이 **없으면 예외 대신 null**을 돌려준다
 * (getByText는 없으면 예외) — "없어야 한다"를 검사하는 데 쓴다. 문자열 매처는 기본이
 * 완전 일치(exact)라 "커플"을 물어도 "연인"에는 안 걸린다(02a §5-A 실검증).
 */

const BUDGET_SLUGS = ['low', 'mid', 'high', 'luxury'] as const;

// 정본 슬러그·라벨 계약(02a §2). couple slug는 유지하되 라벨만 연인→커플, walk 라벨은
// 도보 위주→도보, rental 라벨은 차량→렌터카. 활동 testID는 food와 다른 별도 prefix.
const COMPANION_LABELS: Record<string, string> = {
  solo: '혼자',
  couple: '커플',
  friends: '친구',
  family: '가족',
  parents: '부모님',
  pet: '반려동물',
};
const TRANSPORT_LABELS: Record<string, string> = {
  walk: '도보',
  transit: '대중교통',
  rental: '렌터카',
  taxi: '택시',
  bike: '자전거',
};
const FOOD_LABELS: Record<string, string> = {
  korean: '한식',
  western: '양식',
  japanese: '일식',
  chinese: '중식',
  asian: '아시안',
};
const ACTIVITY_LABELS: Record<string, string> = {
  nature: '자연',
  history: '역사문화',
  themepark: '테마파크',
  foodtour: '맛집투어',
  cafe: '카페',
  exhibition: '전시',
  nightview: '야경',
  shopping: '쇼핑',
};

// 교체로 사라져야 하는 옛 라벨(부재 단언 대상).
const OLD_COMPANION_LABEL = '연인';
const OLD_TRANSPORT_LABELS = ['도보 위주', '차량'];
const OLD_FOOD_LABELS = [
  '맛집 탐방',
  '현지식',
  '해산물',
  '매운 음식',
  '가리는 것 없음',
];

function makeProps(
  overrides: Partial<PrefStep2ScreenProps> = {}
): PrefStep2ScreenProps {
  return {
    selectedBudget: null,
    selectedCompanions: null,
    selectedFoods: null,
    selectedTransports: null,
    selectedActivities: null,
    onToggleBudget: jest.fn(),
    onToggleCompanion: jest.fn(),
    onToggleFood: jest.fn(),
    onToggleTransport: jest.fn(),
    onToggleActivity: jest.fn(),
    onBack: jest.fn(),
    onDone: jest.fn(),
    onSkipAll: jest.fn(),
    ...overrides,
  };
}

describe('PrefStep2Screen — 예산 (무회귀 · US-ONB-06 · 4-1)', () => {
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

describe('PrefStep2Screen — 동행 6종 (AC-1 · US-ONB-07 · 4-2)', () => {
  it('혼자·커플·친구·가족·부모님·반려동물 6종이 보이고 "연인"은 없으며, 복수 선택·탭이 동작한다', () => {
    // 준비 — solo·friends 둘 다 선택된 상태(복수 증명).
    const props = makeProps({ selectedCompanions: ['solo', 'friends'] });
    render(<PrefStep2Screen {...props} />);

    // 단언(존재) — 6 testID + 6 라벨 전부.
    Object.entries(COMPANION_LABELS).forEach(([slug, label]) => {
      expect(
        screen.getByTestId(`onboarding-pref2-companion-${slug}`)
      ).toBeOnTheScreen();
      expect(screen.getByText(label)).toBeOnTheScreen();
    });
    // 단언(부재 ★couple 함정) — 라벨은 "커플"(위에서 존재 확인)이고 "연인"은 없다.
    // g01(여행 생성)은 여전히 "연인"이 옳지만 그건 AC-10이 별도로 지킨다.
    expect(screen.queryByText(OLD_COMPANION_LABEL)).toBeNull();
    // 단언(복수 선택) — 둘 다 selected.
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

describe('PrefStep2Screen — 이동 5종 (AC-2 · US-ONB-09 · 4-3)', () => {
  it('도보·대중교통·렌터카·택시·자전거 5종이 보이고 "도보 위주"·"차량"은 없으며, 복수 선택·탭이 동작한다', () => {
    // 준비 — walk·transit 둘 다 선택.
    const props = makeProps({ selectedTransports: ['walk', 'transit'] });
    render(<PrefStep2Screen {...props} />);

    // 단언(존재) — 5 testID + 5 라벨.
    Object.entries(TRANSPORT_LABELS).forEach(([slug, label]) => {
      expect(
        screen.getByTestId(`onboarding-pref2-transport-${slug}`)
      ).toBeOnTheScreen();
      expect(screen.getByText(label)).toBeOnTheScreen();
    });
    // 단언(부재) — 옛 라벨 "도보 위주"·"차량"은 사라졌다(새 라벨 존재와 같은 it).
    OLD_TRANSPORT_LABELS.forEach((label) => {
      expect(screen.queryByText(label)).toBeNull();
    });
    // 단언(복수 선택) — 이동도 복수다.
    expect(
      screen.getByTestId('onboarding-pref2-transport-walk')
    ).toBeSelected();
    expect(
      screen.getByTestId('onboarding-pref2-transport-transit')
    ).toBeSelected();

    // 실행 — 'rental' 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-transport-rental'));

    // 단언(콜백).
    expect(props.onToggleTransport).toHaveBeenCalledWith('rental');
  });
});

describe('PrefStep2Screen — 음식 5종 (AC-3 · US-ONB-10 · 4-4)', () => {
  it('한식·양식·일식·중식·아시안 5칩이 보이고 구 식사성향 5종은 없으며, 복수 선택·탭이 동작한다', () => {
    // 준비 — korean·japanese 둘 다 선택.
    const props = makeProps({ selectedFoods: ['korean', 'japanese'] });
    render(<PrefStep2Screen {...props} />);

    // 단언(존재) — 5 testID + 5 라벨.
    Object.entries(FOOD_LABELS).forEach(([slug, label]) => {
      expect(
        screen.getByTestId(`onboarding-pref2-food-${slug}`)
      ).toBeOnTheScreen();
      expect(screen.getByText(label)).toBeOnTheScreen();
    });
    // 단언(부재) — 옛 식사성향 5종 라벨이 전부 사라졌다(새 라벨 존재와 같은 it).
    OLD_FOOD_LABELS.forEach((label) => {
      expect(screen.queryByText(label)).toBeNull();
    });
    // 단언(복수 선택).
    expect(screen.getByTestId('onboarding-pref2-food-korean')).toBeSelected();
    expect(screen.getByTestId('onboarding-pref2-food-japanese')).toBeSelected();

    // 실행 — 'chinese' 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-food-chinese'));

    // 단언(콜백).
    expect(props.onToggleFood).toHaveBeenCalledWith('chinese');
  });
});

describe('PrefStep2Screen — 활동 8종 신설 (AC-4 · US-ONB-08 · 4-5)', () => {
  it('활동 8종이 별도 testID로 보이고 복수 선택이 동시에 표시되며 탭하면 onToggleActivity가 호출된다', () => {
    // 준비 — nature·cafe 둘 다 선택(복수 증명).
    const props = makeProps({ selectedActivities: ['nature', 'cafe'] });
    render(<PrefStep2Screen {...props} />);

    // 단언(존재) — 8 testID(★food와 다른 activity prefix) + 8 라벨.
    Object.entries(ACTIVITY_LABELS).forEach(([slug, label]) => {
      expect(
        screen.getByTestId(`onboarding-pref2-activity-${slug}`)
      ).toBeOnTheScreen();
      expect(screen.getByText(label)).toBeOnTheScreen();
    });
    // 단언(복수 선택) — nature·cafe 둘 다 selected.
    expect(
      screen.getByTestId('onboarding-pref2-activity-nature')
    ).toBeSelected();
    expect(screen.getByTestId('onboarding-pref2-activity-cafe')).toBeSelected();

    // 실행 — 'themepark' 탭.
    fireEvent.press(screen.getByTestId('onboarding-pref2-activity-themepark'));

    // 단언(콜백).
    expect(props.onToggleActivity).toHaveBeenCalledWith('themepark');
  });

  it('활동 옵션에 "스포츠"는 없다(계약 8종 · AC-8 렌더 층)', () => {
    // 준비 — 기본 렌더.
    render(<PrefStep2Screen {...makeProps()} />);

    // 단언(루트존재 짝) — 활동 블록이 실재하고(자연 칩 존재)…
    expect(
      screen.getByTestId('onboarding-pref2-activity-nature')
    ).toBeOnTheScreen();
    // …그 안에 "스포츠"는 없다(stories 9종 중 계약에서 빠진 1종).
    expect(screen.queryByText('스포츠')).toBeNull();
  });
});

describe('PrefStep2Screen — 크롬(back·skip) (AC-6 · US-ONB-11 · Q4 · 4-6)', () => {
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

describe('PrefStep2Screen — 완료 항상 활성 + 문구 (AC-6 · 인터뷰4 · 4-7)', () => {
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
