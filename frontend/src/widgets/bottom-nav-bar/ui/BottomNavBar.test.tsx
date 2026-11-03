import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

import { renderedText } from '@/test-support/sheetTree';

import { NavBarBackButton, NavBarCell } from './BottomNavBar';

/**
 * TRIP-1557 · 하단 내비 바 조각(widgets · presentation-only) — 둥근 뒤로(`NavBarBackButton`)와 캡슐 안 칸(`NavBarCell`).
 * 허브(i01)와 기록 3종이 같은 조각을 쓴다.
 * TRIP-1739 D3 — 소비처 없는 조립본 `BottomNavBar` 를 지우면서, 그걸로 칸을 보던 N1~N7 을 조각을 직접 그리는 테스트로 옮겼다(계약 불변).
 *
 * 무엇을 보장하나:
 *  - 구성: 칸 글자는 준 라벨 한 줄(정확 일치)이고 아이콘이 제 칸 안에 선다.
 *  - 배선: 칸을 누르면 그 칸의 콜백만 1회, 뒤로를 누르면 onPress 만 1회다.
 *  - 상태: `selected` 는 부모가 준 칸만 true 다 — 칸은 혼자 활성을 바꾸지 않는다(controlled).
 *  - 비활성: `disabled` 칸은 낭독 상태가 disabled 이고 눌러도 콜백 0회 — 나머지 칸은 그대로 눌린다.
 *  - 낭독: 칸의 `value` 가 accessibilityValue 로 읽힌다(비활성 사유 표현 — 시각 문구를 새로 만들지 않는다).
 *
 * 하지 않는 것: 유리 표면·간격·아이콘 모양(생김새 — 6-b), 뒤로–캡슐 배치와 변신 모션(`LiveBottomBar`·`RecordNavBar` 테스트 몫),
 * 허브 점(`LiveBottomBar` 테스트 몫).
 * 3동작 뼈대: 준비(칸 props 주입) → 실행(render · press) → 단언(역할·이름·상태·콜백).
 */

type CellProps = ComponentProps<typeof NavBarCell>;
type TestCell = CellProps & { key: string };

const BACK = 'test-nav-bar-back';

function cell(
  key: string,
  label: string,
  over: Partial<CellProps> = {}
): TestCell {
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

// 호스트(허브·기록 바)처럼 칸을 한 줄에 나란히 그린다 — "그 칸만 눌린다"를 보려면 형제 칸이 있어야 한다.
function renderCells(cells: TestCell[]) {
  render(
    <View>
      {cells.map(({ key, ...props }) => (
        <NavBarCell key={key} {...props} />
      ))}
    </View>
  );
}

describe('NavBarCell · 구성과 배선', () => {
  it('N1 칸 글자가 준 라벨 한 줄 그대로이고, 칸마다 아이콘이 제 칸 안에 선다', () => {
    const labels = ['일정', '수정', '챗봇', '행사'];
    const cells = labels.map((label, index) => cell(`c${index}`, label));
    renderCells(cells);

    expect(
      screen.getAllByRole('button').map((node) => node.props.accessibilityLabel)
    ).toEqual(labels);
    cells.forEach((spec) => {
      const node = screen.getByTestId(spec.testID);
      expect(renderedText(node)).toBe(spec.label);
      expect(
        within(node).getByTestId(`test-nav-icon-${spec.key}`)
      ).toBeOnTheScreen();
    });
  });

  it('N2 뒤로는 "뒤로" 버튼으로 읽히고, 누르면 onPress 가 1회 불린다', () => {
    const onPress = jest.fn();
    render(<NavBarBackButton testID={BACK} onPress={onPress} />);

    expect(screen.getByRole('button', { name: '뒤로' })).toHaveProp(
      'testID',
      BACK
    );
    fireEvent.press(screen.getByTestId(BACK));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('N3 칸은 버튼으로 읽히고, 누르면 그 칸의 콜백만 1회 부른다', () => {
    const cells = [cell('a', '기록'), cell('b', '회고'), cell('c', '요약')];
    renderCells(cells);

    fireEvent.press(screen.getByRole('button', { name: '회고' }));

    expect(cells[1].onPress).toHaveBeenCalledTimes(1);
    expect(cells[0].onPress).not.toHaveBeenCalled();
    expect(cells[2].onPress).not.toHaveBeenCalled();
  });
});

describe('NavBarCell · 상태 (controlled)', () => {
  it('N4 selected 를 준 칸만 selected 이고, 눌러도 칸 혼자 활성을 옮기지 않는다 — 콜백만 부른다', () => {
    const cells = [
      cell('a', '기록', { selected: true }),
      cell('b', '회고'),
      cell('c', '요약'),
    ];
    renderCells(cells);

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
    renderCells(cells);

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

describe('NavBarCell · 비활성 칸 (TRIP-1557 AC-12)', () => {
  it('N6 disabled 칸은 비활성으로 읽히고 눌러도 콜백 0회이며, 나머지 칸은 그대로 눌린다 (상태만이 아니라 효과 0까지)', () => {
    const cells = [
      cell('a', '기록', { selected: true }),
      cell('b', '회고'),
      cell('c', '요약', { disabled: true, value: '요약 준비 중' }),
    ];
    renderCells(cells);
    const idle = screen.getByTestId(cells[2].testID);

    // 짝 앵커 — 칸은 그려졌고 다른 칸은 살아 있다(통째로 죽은 렌더가 공허하게 통과하지 않게).
    expect(screen.getByTestId(cells[0].testID)).toBeEnabled();
    expect(screen.getByTestId(cells[1].testID)).toBeEnabled();
    expect(idle).toBeDisabled();
    expect(idle.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(idle);
    expect(cells[2].onPress).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(cells[1].testID));
    expect(cells[1].onPress).toHaveBeenCalledTimes(1);
  });

  it('N7 value 는 낭독 값(accessibilityValue)으로 읽히고, 안 준 칸에는 없다', () => {
    const cells = [
      cell('a', '기록'),
      cell('c', '요약', { disabled: true, value: '요약 준비 중' }),
    ];
    renderCells(cells);

    expect(screen.getByTestId(cells[1].testID)).toHaveAccessibilityValue({
      text: '요약 준비 중',
    });
    expect(
      screen.getByTestId(cells[0].testID).props.accessibilityValue?.text
    ).toBeUndefined();
  });
});
