import { fireEvent, render, screen } from '@testing-library/react-native';

import { closestScrollView, stubScrollTo } from '@/test-support/sheetTree';

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

/**
 * TRIP-1417 · L (Q-100 · 01b D1) — 레이아웃이 끝나면 선택 셀을 가운데 밴드로 **다시** 맞춘다.
 *
 * 실기에서 `contentOffset` 값은 맞는데 휠이 엉뚱한 칸에 서 있었다 — 재활용된 네이티브 스크롤뷰의 옛 크기로
 * 마운트 때 오프셋이 잘린다(브리프 ①). 그래서 크기가 확정된 뒤(`onLayout`) `scrollTo` 로 한 번 더 맞춘다.
 *
 * 무엇을 보장하나: layout 이벤트가 오면 그 열의 `scrollTo` 가 `{ y: 선택 인덱스 × 셀 높이, animated: false }` 로
 * 1회 불린다. 선택이 없거나 목록에 없으면 y 0.
 *
 * 커버하지 않는 것(02a ★5): 실제로 밴드 안에 오는지(재활용 재현)는 jest 가 모른다 — 6-b 실기.
 *
 * *(개념)* RN jest 목의 `scrollTo` 는 모든 ScrollView 가 함께 쓰는 가짜라, 이 열의 인스턴스에 새 가짜를 꽂아
 *   이 열의 호출만 센다(`stubScrollTo`, 02a ★1).
 *
 * 3동작 뼈대: 준비=선택값으로 렌더·가짜 꽂기 → 실행=layout 이벤트 → 단언=scrollTo 인자·횟수.
 */
describe('🔴 L · 레이아웃이 끝나면 선택 셀 위치로 다시 스크롤한다', () => {
  const WHEEL = 'wheel-scroll';

  it.each<[string | null, number, string]>([
    ['10:00', 2, '세 번째 값 → 2칸'],
    [null, 0, '선택 없음 → 맨 위'],
    ['11:00', 0, '목록에 없는 값 → 맨 위'],
  ])('selected=%s → y = %i칸 (%s)', (selected, cells) => {
    // 준비: 휠을 렌더하고, 그 열 ScrollView 의 scrollTo 를 새 가짜로 바꾼다.
    render(
      <WheelPicker
        testID={WHEEL}
        values={VALUES}
        selected={selected}
        onSelect={jest.fn()}
        testIDForValue={cellTestID}
      />
    );
    const scroll = closestScrollView(screen.getByTestId(cellTestID('09:00')));
    expect(scroll).not.toBeNull();
    const scrollTo = stubScrollTo(scroll!);
    // 앵커 — layout 전에는 아무도 부르지 않았다(02a ★2).
    expect(scrollTo).not.toHaveBeenCalled();

    // 실행: 크기가 확정됐다는 layout 이벤트(열 높이 220 = 5행 × 44).
    fireEvent(screen.getByTestId(WHEEL), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 220 } },
    });

    // 단언: 선택 칸 위치로, 애니메이션 없이, 한 번.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ y: cells * WHEEL_CELL_HEIGHT, animated: false })
    );
  });
});

/**
 * TRIP-1437 · A (Q-066 · 01b Q2) — 고른 값이 없을 때 휠을 **세울 자리**(`anchor`)를 따로 받는다.
 *
 * 지금은 "선택 없음 = 맨 위"라 방문 시각 휠이 자정(00:00)에서 시작했다. 선택(`selected`, 저장될 값)과
 * 위치(`anchor`, 눈이 머무는 칸)를 떼어, 값은 비운 채 위치만 일과 시작으로 옮긴다(BR-U1-49 — 보기만으로
 * 값이 정해지면 안 된다).
 *
 * 무엇을 보장하나:
 *  - 선택이 없고 `anchor` 가 목록에 있으면 첫 위치(`contentOffset`)와 레이아웃 뒤 `scrollTo` 가 그 칸이다.
 *  - 그래도 어떤 셀도 selected 가 아니고, 렌더·레이아웃만으로 `onSelect` 가 불리지 않는다.
 *  - 선택이 있으면 `anchor` 는 무시된다(선택이 이긴다). 목록에 없는 `anchor` 는 맨 위.
 *  - `anchor` 를 안 주면 위 L 표 그대로다(1417 계약 — `[null → 0]` 행이 산다).
 *
 * 커버하지 않는 것(6-b): 프로그램이 굴린 `scrollTo` 가 실기에서 정지 이벤트(`onMomentumScrollEnd`)를
 *   쏴서 값이 확정되는 길이 있는지 — jest 의 `scrollTo` 는 가짜라 그 이벤트를 절대 내지 않는다(브리프 §8①).
 *
 * 3동작 뼈대: 준비=selected·anchor 로 렌더·가짜 꽂기 → 실행=layout 이벤트 → 단언=위치·선택 표식·onSelect.
 */
describe('🔴 A · 선택 없이 위치만 세운다 — anchor (TRIP-1437)', () => {
  const WHEEL = 'wheel-scroll';

  it.each<[string | null, string, number, string | null, string]>([
    [null, '10:00', 2, null, '선택 없음 → anchor 칸(2칸), 선택 표식 없음'],
    ['09:30', '10:00', 1, '09:30', '선택이 있으면 anchor 무시 → 선택 칸(1칸)'],
    [null, '11:00', 0, null, '목록에 없는 anchor → 맨 위'],
  ])(
    'selected=%s · anchor=%s → y = %i칸, 선택 셀 %s (%s)',
    (selected, anchor, cells, selectedCell) => {
      // 준비: 휠을 렌더하고 그 열 ScrollView 의 scrollTo 를 새 가짜로 바꾼다(L 과 같은 도구).
      const onSelect = jest.fn();
      render(
        <WheelPicker
          testID={WHEEL}
          values={VALUES}
          selected={selected}
          anchor={anchor}
          onSelect={onSelect}
          testIDForValue={cellTestID}
        />
      );
      const scroll = closestScrollView(screen.getByTestId(cellTestID('09:00')));
      expect(scroll).not.toBeNull();
      const scrollTo = stubScrollTo(scroll!);
      expect(scrollTo).not.toHaveBeenCalled();
      // 첫 프레임 위치도 같은 칸이어야 00 에서 튀었다 오지 않는다(1417 승계 — contentOffset 유지).
      expect(screen.getByTestId(WHEEL).props.contentOffset?.y).toBe(
        cells * WHEEL_CELL_HEIGHT
      );

      // 실행: 크기가 확정됐다는 layout 이벤트.
      fireEvent(screen.getByTestId(WHEEL), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 220 } },
      });

      // 단언: 그 칸으로 한 번 · 선택 표식은 selected 에만 · 보기만으로는 값이 안 나간다.
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({
          y: cells * WHEEL_CELL_HEIGHT,
          animated: false,
        })
      );
      VALUES.forEach((value) => {
        const cell = screen.getByTestId(cellTestID(value));
        if (value === selectedCell) expect(cell).toBeSelected();
        else expect(cell).not.toBeSelected();
      });
      expect(onSelect).not.toHaveBeenCalled();
    }
  );
});
