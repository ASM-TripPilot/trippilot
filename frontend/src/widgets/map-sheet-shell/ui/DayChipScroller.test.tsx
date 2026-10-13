import { FlatList, Pressable, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import {
  closestAncestor,
  closestScrollView,
  fireChipLayout,
  stubScrollTo,
} from '@/test-support/sheetTree';

import { DayChipScroller } from './DayChipScroller';

/**
 * TRIP-1260 · 일차 칩 줄 가로 스크롤 컨테이너(widgets · presentation-only).
 *
 * 무엇을 보장하나:
 *  - 넘겨받은 칩을 손대지 않고 **가로 ScrollView** 안에 순서대로 그린다(AC-1). FlatList 계열이 아니다 —
 *    셸 테스트 도우미 `sheetScrollOf` 가 가장 가까운 FlatList 를 "시트 본문"으로 읽기 때문(02a ★1).
 *  - 선택이 바뀌면 그 칩이 보이도록 `scrollTo` 한다 — 목표 x 는 0 초과·칩 x 이하(AC-3 · 01b D4).
 *    오른쪽으로 갔다가 왼쪽 칩으로 돌아와도 다시 보이게 한다.
 *  - 처음부터 화면 밖 칩이 선택돼 있으면, 그 칩의 위치가 도착할 때 스크롤한다(AC-3b · D3).
 *  - 칩이 다 들어갈 때 끌어도 따라오지 않게 iOS 고무줄 튕김을 끈다(AC-5 의 jest 가 볼 수 있는 절반).
 *
 * ⚠️ 원리적 사각(6-b): 칩이 실제로 잘리는지·밀리는지·선택 칩이 화면 안에 들어왔는지·줄 높이.
 * 3동작 뼈대: 준비=칩 7개 렌더(+칩 위치 주입) → 실행=선택 바꾸기(재렌더) → 단언=scrollTo 인자.
 */

const CHIP_COUNT = 7;

function chips() {
  return Array.from({ length: CHIP_COUNT }, (_, index) => (
    <Pressable key={index} testID={`probe-chip-${index}`}>
      <Text>{`${index + 1}일차`}</Text>
    </Pressable>
  ));
}

function ui(selectedIndex: number) {
  return (
    <DayChipScroller selectedIndex={selectedIndex}>{chips()}</DayChipScroller>
  );
}

function chip(index: number) {
  return screen.getByTestId(`probe-chip-${index}`);
}

describe('🔴 DayChipScroller · S1 — 칩을 가로 ScrollView 안에 그대로 그린다 (AC-1)', () => {
  it('칩 7개가 순서대로 있고, 모두 같은 가로 ScrollView 안이며, FlatList 안이 아니다', () => {
    render(ui(0));

    const ids = screen
      .getAllByTestId(/^probe-chip-\d+$/)
      .map((node) => node.props.testID);
    expect(ids).toEqual(
      Array.from({ length: CHIP_COUNT }, (_, index) => `probe-chip-${index}`)
    );
    const scroll = closestScrollView(chip(0));
    expect(scroll?.props.horizontal).toBe(true);
    for (let index = 1; index < CHIP_COUNT; index += 1) {
      expect(closestScrollView(chip(index))).toBe(scroll);
    }
    // 가로 FlatList 도 안쪽에 가로 ScrollView 를 그려 위 단언을 통과한다 — 그래서 따로 막는다.
    expect(
      closestAncestor(chip(0), (node) => node.type === (FlatList as unknown))
    ).toBeNull();
  });

  it('칩이 다 들어갈 때 끌어도 따라오지 않게 고무줄 튕김을 끈다 (AC-5 jest 절반)', () => {
    render(ui(0));

    const scroll = closestScrollView(chip(0));
    expect(scroll).not.toBeNull();
    // alwaysBounceHorizontal=false 가 정확한 끄개다(가로 ScrollView 기본값 true). bounces=false 는 긴 줄의
    // 끝 튕김까지 끄지만 AC 를 어기지 않아 함께 허용한다.
    const noBounce =
      scroll?.props.alwaysBounceHorizontal === false ||
      scroll?.props.bounces === false;
    expect(noBounce).toBe(true);
  });
});

describe('🔴 DayChipScroller · S2 — 선택을 바꾸면 그 칩이 보이게 스크롤한다 (AC-3)', () => {
  it('오른쪽 칩(x=400)을 고르면 0 < x ≤ 400 으로 scrollTo 하고, 왼쪽 칩(x=56)으로 돌아오면 x ≤ 56 으로 다시 scrollTo 한다', () => {
    // 준비 — 칩 위치를 넣는다. 선택(0)이 그대로면 아직 스크롤하지 않는다.
    const view = render(ui(0));
    const scrollTo = stubScrollTo(closestScrollView(chip(5))!);
    fireChipLayout(chip(1), 56);
    fireChipLayout(chip(5), 400);
    expect(scrollTo).not.toHaveBeenCalled();

    // 실행 — 6일차(index 5)로 바꾼다.
    view.rerender(ui(5));

    // 단언 — 그 칩 쪽으로 스크롤. 0 은 "늘 맨 앞" 구현을 통과시키므로 0 초과를 요구한다(02a ★5).
    expect(scrollTo).toHaveBeenCalled();
    const right = scrollTo.mock.lastCall?.[0] as { x: number };
    expect(right.x).toBeGreaterThan(0);
    expect(right.x).toBeLessThanOrEqual(400);

    // 실행 — 2일차(index 1)로 돌아온다.
    scrollTo.mockClear();
    view.rerender(ui(1));

    // 단언 — 오른쪽으로만 미는 구현이면 2일차가 왼쪽 밖에 남는다.
    expect(scrollTo).toHaveBeenCalled();
    const left = scrollTo.mock.lastCall?.[0] as { x: number };
    expect(left.x).toBeGreaterThanOrEqual(0);
    expect(left.x).toBeLessThanOrEqual(56);
  });
});

describe('🔴 DayChipScroller · S3 — 처음부터 화면 밖 칩이 선택돼 있으면 위치가 도착할 때 스크롤한다 (AC-3b)', () => {
  it('6일차 선택으로 열고, 다른 칩 위치엔 가만히 있다가 6일차 위치(x=400)가 오면 0 < x ≤ 400 으로 scrollTo 한다', () => {
    // 준비 — 6일차(index 5)가 선택된 채로 연다.
    render(ui(5));
    const scrollTo = stubScrollTo(closestScrollView(chip(5))!);

    // 짝 — 선택 아닌 칩의 위치가 와도 스크롤하지 않는다.
    fireChipLayout(chip(2), 200);
    expect(scrollTo).not.toHaveBeenCalled();

    // 실행 — 선택 칩의 위치가 도착한다.
    fireChipLayout(chip(5), 400);

    // 단언
    expect(scrollTo).toHaveBeenCalled();
    const target = scrollTo.mock.lastCall?.[0] as { x: number };
    expect(target.x).toBeGreaterThan(0);
    expect(target.x).toBeLessThanOrEqual(400);
  });
});
