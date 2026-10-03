import { fireEvent, render, screen } from '@testing-library/react-native';

import { StayPriceSheet } from './StayPriceSheet';

/**
 * TRIP-457 AC-12 — 가격대 필터 시트(StayPriceSheet)의 렌더·배선 계약(01b Q4 (a)).
 *
 * 무엇을 보장하나: 프리셋 가격 버킷 4개를 라디오로 그리고, 선택을 콜백으로 올린다. **완전 제어**
 * (useState 0) — 선택된 버킷·열림은 페이지가 소유(StayFilterSheet 선례). 실제 필터링은
 * `priceRangeFilter` 순수 함수 + 페이지가 진다(이 시트는 UI 만).
 *
 * *(개념)* 선택 표시는 색이 아니라 `accessibilityState.selected`(=`toBeSelected()`) 로 잰다.
 * gorhom 목이 통과 컴포넌트라 실제 시트 열림·딤은 무심판(6-b 실기, ★F-11).
 */

function noop(): void {}

describe('P1 · 4버킷 렌더 (AC-12)', () => {
  it('버킷 4개를 라디오로 그리고 선택된 것만 selected 다', () => {
    render(<StayPriceSheet selected="all" onSelect={noop} onClose={noop} />);

    expect(screen.getByTestId('stay-price-option-all')).toBeOnTheScreen();
    expect(
      screen.getByTestId('stay-price-option-under-100k')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('stay-price-option-100k-200k')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-price-option-over-200k')).toBeOnTheScreen();

    expect(screen.getByTestId('stay-price-option-all')).toBeSelected();
    expect(
      screen.getByTestId('stay-price-option-under-100k')
    ).not.toBeSelected();
  });
});

describe('P2 · 선택 배선', () => {
  it('버킷 행을 누르면 그 id 로 onSelect 를 부른다', () => {
    const onSelect = jest.fn();
    render(
      <StayPriceSheet selected="all" onSelect={onSelect} onClose={noop} />
    );

    fireEvent.press(screen.getByTestId('stay-price-option-over-200k'));

    // 누르는 즉시 한 번 — "적용" 없이 고르는 순간이 곧 적용이다(TRIP-1019 #013).
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('over-200k');
  });
});

// TRIP-1019 #013 — 옵션을 누르는 즉시 적용되므로 "적용" 버튼은 할 일이 없었다(결정 3). 버튼을 없애도
// 시트를 닫는 길은 남아야 한다: 옵션을 고르면 페이지가 닫고(통합 테스트 PF-close), 아래로 끌어내리면
// gorhom 이 onClose 를 부른다. 통과형 목은 BottomSheet prop 을 노드에 그대로 싣는다 — 실제 끌기는
// 실기 몫이라 여기서는 라이브러리가 부를 onClose 를 직접 부른다(RiskDetailSheet S10 선례).
describe('P3 · "적용" 버튼 없음 · 끌어내려 닫기는 onClose (TRIP-1019 #013 · 01b Q1)', () => {
  it('"적용" 버튼(stay-price-close)과 "적용" 글자가 없다', () => {
    render(<StayPriceSheet selected="all" onSelect={noop} onClose={noop} />);

    // 앵커: 시트 자체는 그려졌다(없어서 통과하는 부재 단언 방지).
    expect(screen.getByTestId('stay-price-sheet')).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-price-close')).toBeNull();
    expect(screen.queryByText('적용')).toBeNull();
  });

  it('아래로 끌어 닫기(enablePanDownToClose)가 켜져 있고, 라이브러리가 부르는 onClose 가 그대로 이어진다', () => {
    const onClose = jest.fn();
    render(<StayPriceSheet selected="all" onSelect={noop} onClose={onClose} />);

    const panNodes = screen.UNSAFE_root.findAll(
      (node) => node.props?.enablePanDownToClose === true
    );
    expect(panNodes.length).toBeGreaterThan(0);
    (panNodes[panNodes.length - 1].props.onClose as () => void)();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
