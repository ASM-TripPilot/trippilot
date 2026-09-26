import { fireEvent, render, screen } from '@testing-library/react-native';

import { WHEEL_CELL_HEIGHT, WheelPicker } from './WheelPicker';

/**
 * shared/ui 값-컬럼 휠 primitive 의 **계약**(TRIP-599 · AC-1·2).
 *
 * 이 컴포넌트는 도메인을 모른다 — 표시 문자열과 셀 testID 를 소비처가 함수로 주입한다. 그래서
 * 테스트도 도메인 값(시각) 대신 임의의 `values` 로 계약만 잰다.
 *
 * 무엇을 보장하나:
 *  - 넘긴 모든 값이 셀로 트리에 실재하고, 라벨은 `renderLabel` 을 거친 문자열이다(AC-1).
 *  - 셀을 누르면 그 값으로 `onSelect` 가 **정확히 1회** 불린다 — 셀 안 라벨 Text 가 press 를
 *    가로채 두 번 불리지 않는지(버블링)까지 `toHaveBeenCalledTimes(1)` 로 잠근다(AC-1 · 02a ★6).
 *  - `selected` 와 문자열이 같은 셀만 `accessibilityState.selected` 다(AC-2).
 *
 * 잠기지 않는 것(02a ★3): 실제 스크롤-스냅·중앙정렬·관성 스크롤은 jest 가 원리적으로 못
 * 돌린다 — 6-b 실기(프리뷰 `itinerary-mustvisit-time-default`) 전용이다.
 *
 * *(개념)* **`accessibilityState.selected`** — "이 항목이 지금 선택됨" 을 스크린리더·테스트에
 * 알리는 표준 표식. 눈에 보이는 색과 별개로 테스트가 붙잡는 손잡이이고, `toBeSelected()` 로
 * 읽는다(RNTL: `accessibilityState.selected ?? false` — 02a §5).
 *
 * 3동작 뼈대: 준비=props 로 렌더 → 실행=셀을 누른다 → 단언=보이는 셀·불린 콜백·선택 표식.
 */

const VALUES = ['09:00', '09:30', '10:00'];
const cellTestID = (value: string) => `wheel-cell-${value}`;

describe('AC-1 · 값 셀 실재 + 셀 press → onSelect (US-SCHED-04 · INV-2)', () => {
  it('모든 값이 셀로 뜨고(라벨은 renderLabel 결과), 누른 셀 값으로 onSelect 가 1회 불린다', () => {
    // 준비: 세 값·목 onSelect·주입 renderLabel/testIDForValue 로 렌더.
    const onSelect = jest.fn();
    render(
      <WheelPicker
        values={VALUES}
        selected={null}
        onSelect={onSelect}
        renderLabel={(value) => `골라: ${value}`}
        testIDForValue={cellTestID}
      />
    );

    // 단언(긍정): 넘긴 세 값이 전부 셀로 실재하고, 라벨은 주입한 renderLabel 을 거친다.
    VALUES.forEach((value) =>
      expect(screen.getByTestId(cellTestID(value))).toBeOnTheScreen()
    );
    expect(screen.getByTestId(cellTestID('09:30'))).toHaveTextContent(
      '골라: 09:30'
    );

    // 누르기 전에는 아무것도 안 불린다 — 렌더만으로 선택되지 않는다.
    expect(onSelect).not.toHaveBeenCalled();

    // 실행: 가운데 셀을 누른다.
    fireEvent.press(screen.getByTestId(cellTestID('09:30')));

    // 단언(짝): 그 값으로 정확히 한 번. 라벨 Text 버블링으로 두 번 불리면 여기서 red.
    expect(onSelect).toHaveBeenCalledWith('09:30');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('AC-2 · 선택 셀만 accessibilityState.selected (INV-2)', () => {
  it('selected 와 같은 값의 셀만 selected 이고 나머지는 아니다', () => {
    // 준비: 가운데 값이 selected. (renderLabel 없이 — 기본은 값 그대로)
    render(
      <WheelPicker
        values={VALUES}
        selected="09:30"
        onSelect={jest.fn()}
        testIDForValue={cellTestID}
      />
    );

    // 단언(긍정): 선택값 셀은 selected.
    expect(screen.getByTestId(cellTestID('09:30'))).toBeSelected();
    // 단언(부정 짝): 나머지는 아니다 — 비교는 참조가 아니라 문자열 동등이어야 한다(02a ★6).
    expect(screen.getByTestId(cellTestID('09:00'))).not.toBeSelected();
    expect(screen.getByTestId(cellTestID('10:00'))).not.toBeSelected();
  });

  it('selected 가 null 이면 어떤 셀도 selected 가 아니다', () => {
    render(
      <WheelPicker
        values={VALUES}
        selected={null}
        onSelect={jest.fn()}
        testIDForValue={cellTestID}
      />
    );

    VALUES.forEach((value) =>
      expect(screen.getByTestId(cellTestID(value))).not.toBeSelected()
    );
  });
});

/**
 * TRIP-990 · W1 (D21) — 스크롤이 멈추면 가운데 값을 자동으로 확정한다.
 *
 * *(개념)* `onMomentumScrollEnd` = 손을 뗀 뒤 관성으로 굴러가던 스크롤이 완전히 멈춘 순간 한 번 불리는
 * 이벤트. `nativeEvent.contentOffset.y` 로 멈춘 위치를 알려 준다. 위 패딩 덕에 y 가 `k × 셀 높이` 이면
 * k 번째 값이 가운데 밴드에 온다.
 *
 * 무엇을 보장하나: 멈춘 위치 → 가장 가까운 칸(반올림) → 양 끝을 넘으면 끝 값으로 자름(clamp) →
 * `onSelect` **정확히 1회**. 1.6칸은 2칸이다(내림이면 1칸이라 여기서 갈린다).
 *
 * 커버하지 않는 것: 실제 관성·스냅·관성 없이 손을 뗄 때 이벤트가 안 오는 경우는 jest 가 이벤트를 직접
 * 쏘므로 못 본다 — 6-b 실기(프리뷰 `itinerary-mustvisit-time-default`).
 *
 * 3동작 뼈대: 준비=값 5개 휠 → 실행=스크롤 정지 이벤트 → 단언=확정된 값과 횟수.
 */
describe('🔴 W1 · 스크롤 정지 → 가운데 값 자동 확정 (D21 · INV-2)', () => {
  const FIVE = ['a', 'b', 'c', 'd', 'e'];

  function renderWheel() {
    const onSelect = jest.fn();
    render(
      <WheelPicker
        testID="wheel-scroll"
        values={FIVE}
        selected={null}
        onSelect={onSelect}
        testIDForValue={cellTestID}
      />
    );
    return onSelect;
  }

  function settleAt(y: number): void {
    fireEvent(screen.getByTestId('wheel-scroll'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 0, y } },
    });
  }

  it('정확히 2칸에서 멈추면 세 번째 값으로 onSelect 가 1회 불린다', () => {
    const onSelect = renderWheel();
    expect(onSelect).not.toHaveBeenCalled();

    settleAt(2 * WHEEL_CELL_HEIGHT);

    expect(onSelect).toHaveBeenCalledWith('c');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1.4, 'b', '반올림 — 1.4칸은 1칸'],
    [1.6, 'c', '반올림 — 1.6칸은 2칸(내림과 갈리는 자리)'],
    [-1, 'a', '위로 넘치면 첫 값'],
    [100, 'e', '아래로 넘치면 마지막 값'],
  ])('%s칸에서 멈추면 %s (%s)', (cells, expected) => {
    const onSelect = renderWheel();

    settleAt(cells * WHEEL_CELL_HEIGHT);

    expect(onSelect).toHaveBeenCalledWith(expected);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
