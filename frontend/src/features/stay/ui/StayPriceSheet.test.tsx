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

    expect(onSelect).toHaveBeenCalledWith('over-200k');
  });
});

describe('P3 · 닫기 배선', () => {
  it('닫기를 누르면 onClose 를 부른다', () => {
    const onClose = jest.fn();
    render(<StayPriceSheet selected="all" onSelect={noop} onClose={onClose} />);

    fireEvent.press(screen.getByTestId('stay-price-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
