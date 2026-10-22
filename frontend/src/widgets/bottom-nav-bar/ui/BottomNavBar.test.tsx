import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { View } from 'react-native';

import { renderedText } from '@/test-support/sheetTree';

import { BottomNavBar, type NavBarCellSpec } from './BottomNavBar';

/**
 * TRIP-1557 · 하단 내비 바(widgets · presentation-only) — 둥근 뒤로 + 캡슐 안 N칸. 허브(i01)와 j01 이 같은 부품을 쓴다.
 *
 * 무엇을 보장하나:
 *  - 구성(AC-2·AC-12): 부모가 준 칸이 준 순서대로 서고(글자 정확 일치), 뒤로 원이 따로 있다. 칸 수(3·4)를 가리지 않는다.
 *  - 배선: 칸을 누르면 그 칸의 콜백만 1회, 뒤로를 누르면 onBack 만 1회다.
 *  - 상태(AC-2): `selected` 는 부모가 준 칸만 true 다 — 바는 혼자 활성을 바꾸지 않는다(controlled).
 *  - 비활성(AC-12): `disabled` 칸은 낭독 상태가 disabled 이고 눌러도 콜백 0회 — 나머지 칸은 그대로 눌린다.
 *  - 낭독: 칸의 `value` 가 accessibilityValue 로 읽힌다(비활성 사유 표현 — 시각 문구를 새로 만들지 않는다).
 *
 * 하지 않는 것: 유리 표면·간격·아이콘 모양(생김새 — 6-b), 허브의 변신 모션(허브 전용이라 `LiveBottomBar` 테스트 몫).
 * 3동작 뼈대: 준비(칸 명세 주입) → 실행(render · press) → 단언(역할·이름·상태·콜백).
 */

const ROOT = 'test-nav-bar';
const BACK = 'test-nav-bar-back';

function cell(
  key: string,
  label: string,
  over: Partial<NavBarCellSpec> = {}
): NavBarCellSpec {
  return {
    key,
    testID: `test-nav-bar-${key}`,
    label,
    icon: <View testID={`test-nav-icon-${key}`} />,
    selected: false,
    onPress: jest.fn(),
    ...over,
  };
}

function renderBar(cells: NavBarCellSpec[]) {
  const onBack = jest.fn();
  render(
    <BottomNavBar
      testID={ROOT}
      backTestID={BACK}
      onBack={onBack}
      cells={cells}
    />
  );
  return { onBack };
}

describe('🔴 TRIP-1557 BottomNavBar · 구성과 배선', () => {
  it.each([
    ['3칸(j01)', ['기록', '회고', '요약']],
    ['4칸(허브)', ['일정', '수정', '챗봇', '행사']],
  ])(
    'N1 %s — 루트 안에 뒤로 원이 있고, 칸 글자가 준 순서 그대로이며 칸마다 아이콘이 제 칸 안에 선다',
    (_name, labels) => {
      const cells = labels.map((label, index) => cell(`c${index}`, label));
      renderBar(cells);

      const root = screen.getByTestId(ROOT);
      expect(within(root).getByTestId(BACK)).toBeOnTheScreen();
      // 버튼 순서 = 뒤로 → 준 칸 순서. 글자는 칸 안에 정확히 그 라벨 한 줄이다.
      expect(
        screen
          .getAllByRole('button')
          .map((node) => node.props.accessibilityLabel)
      ).toEqual(['뒤로', ...labels]);
      cells.forEach((spec) => {
        const node = screen.getByTestId(spec.testID);
        expect(renderedText(node)).toBe(spec.label);
        expect(
          within(node).getByTestId(`test-nav-icon-${spec.key}`)
        ).toBeOnTheScreen();
      });
    }
  );

  it('N2 뒤로는 "뒤로" 버튼으로 읽히고, 누르면 onBack 만 1회 불린다(칸 콜백 0회)', () => {
    const cells = [cell('a', '기록'), cell('b', '회고')];
    const { onBack } = renderBar(cells);

    expect(screen.getByRole('button', { name: '뒤로' })).toHaveProp(
      'testID',
      BACK
    );
    fireEvent.press(screen.getByTestId(BACK));

    expect(onBack).toHaveBeenCalledTimes(1);
    cells.forEach((spec) => expect(spec.onPress).not.toHaveBeenCalled());
  });

  it('N3 칸은 버튼으로 읽히고, 누르면 그 칸의 콜백만 1회 부른다', () => {
    const cells = [cell('a', '기록'), cell('b', '회고'), cell('c', '요약')];
    const { onBack } = renderBar(cells);

    fireEvent.press(screen.getByRole('button', { name: '회고' }));

    expect(cells[1].onPress).toHaveBeenCalledTimes(1);
    expect(cells[0].onPress).not.toHaveBeenCalled();
    expect(cells[2].onPress).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1557 BottomNavBar · 상태 (controlled)', () => {
  it('N4 selected 를 준 칸만 selected 이고, 눌러도 바 혼자 활성을 옮기지 않는다 — 콜백만 부른다', () => {
    const cells = [
      cell('a', '기록', { selected: true }),
      cell('b', '회고'),
      cell('c', '요약'),
    ];
    renderBar(cells);

    expect(screen.getByTestId(cells[0].testID)).toBeSelected();
    expect(screen.getByTestId(cells[1].testID)).not.toBeSelected();
    expect(screen.getByTestId(cells[2].testID)).not.toBeSelected();

    fireEvent.press(screen.getByTestId(cells[1].testID));

    expect(cells[1].onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(cells[0].testID)).toBeSelected();
    expect(screen.getByTestId(cells[1].testID)).not.toBeSelected();
  });

  it('N5 expanded 는 준 값 그대로 낭독 상태에 실린다(true/false), 안 주면 상태에 없다', () => {
    const cells = [
      cell('a', '일정'),
      cell('b', '수정', { expanded: true }),
      cell('c', '행사', { expanded: false }),
    ];
    renderBar(cells);

    expect(
      screen.getByTestId(cells[0].testID).props.accessibilityState.expanded
    ).toBeUndefined();
    expect(
      screen.getByTestId(cells[1].testID).props.accessibilityState.expanded
    ).toBe(true);
    expect(
      screen.getByTestId(cells[2].testID).props.accessibilityState.expanded
    ).toBe(false);
  });
});

describe('🔴 TRIP-1557 AC-12 BottomNavBar · 비활성 칸', () => {
  it('N6 disabled 칸은 비활성으로 읽히고 눌러도 콜백 0회이며, 나머지 칸·뒤로는 그대로 눌린다 (상태만이 아니라 효과 0까지)', () => {
    const cells = [
      cell('a', '기록', { selected: true }),
      cell('b', '회고'),
      cell('c', '요약', { disabled: true, value: '요약 준비 중' }),
    ];
    const { onBack } = renderBar(cells);
    const idle = screen.getByTestId(cells[2].testID);

    // 짝 앵커 — 바는 그려졌고 다른 칸·뒤로는 살아 있다(통째로 죽은 렌더가 공허하게 통과하지 않게).
    expect(screen.getByTestId(cells[0].testID)).toBeEnabled();
    expect(screen.getByTestId(cells[1].testID)).toBeEnabled();
    expect(idle).toBeDisabled();
    expect(idle.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(idle);
    expect(cells[2].onPress).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(cells[1].testID));
    fireEvent.press(screen.getByTestId(BACK));
    expect(cells[1].onPress).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('N7 value 는 낭독 값(accessibilityValue)으로 읽히고, 안 준 칸에는 없다', () => {
    const cells = [
      cell('a', '기록'),
      cell('c', '요약', { disabled: true, value: '요약 준비 중' }),
    ];
    renderBar(cells);

    expect(screen.getByTestId(cells[1].testID)).toHaveAccessibilityValue({
      text: '요약 준비 중',
    });
    expect(
      screen.getByTestId(cells[0].testID).props.accessibilityValue?.text
    ).toBeUndefined();
  });
});
