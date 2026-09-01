import { fireEvent, render, screen } from '@testing-library/react-native';

import { CompareSegment } from './CompareSegment';

/**
 * TRIP-570 · AC-1 · j02 3탭 세그먼트(계획·실제·변경) — 무상태 프레젠테이션.
 * 활성 탭은 accessibilityState.selected 로 노출(색이 아니라 구조로 판독, fill 함정 회피 —
 * `ConflictSheet`/`FormatSegment` 선례). press → onSelect(tab) 1회.
 *
 * 무엇을 보장하나:
 *  - 🔴 CS-1: 세그 루트 + 3탭 라벨이 렌더된다.
 *  - 🔴 CS-2: activeTab 인 탭만 selected(나머지는 not selected).
 *  - 🔴 CS-3: 탭 press → onSelect 가 그 tab id 로 정확히 1회 불린다.
 *
 * (개념) `toBeSelected()` = accessibilityState.selected 판독 · `getByText` = leaf 완전일치 ·
 *   `fireEvent.press` 는 실제 터치를 흉내내 onPress 발화.
 */

describe('🔴 CS-1 · 세그 렌더 — 루트 + 3탭 라벨', () => {
  it('record-compare-segment 와 계획·실제·변경 라벨이 그려진다', () => {
    render(<CompareSegment activeTab="actual" onSelect={jest.fn()} />);

    expect(screen.getByTestId('record-compare-segment')).toBeOnTheScreen();
    expect(screen.getByText('계획')).toBeOnTheScreen();
    expect(screen.getByText('실제')).toBeOnTheScreen();
    expect(screen.getByText('변경')).toBeOnTheScreen();
  });
});

describe('🔴 CS-2 · 활성 탭 표기 — activeTab 만 selected', () => {
  it('activeTab=actual 이면 실제 탭만 selected 다', () => {
    render(<CompareSegment activeTab="actual" onSelect={jest.fn()} />);

    expect(screen.getByTestId('record-compare-tab-actual')).toBeSelected();
    expect(screen.getByTestId('record-compare-tab-planned')).not.toBeSelected();
    expect(screen.getByTestId('record-compare-tab-change')).not.toBeSelected();
  });
});

describe('🔴 CS-3 · 전환 콜백 — press → onSelect(tab)', () => {
  it('변경 탭을 누르면 onSelect 가 "change" 로 정확히 1회 불린다', () => {
    const onSelect = jest.fn();
    render(<CompareSegment activeTab="actual" onSelect={onSelect} />);

    fireEvent.press(screen.getByTestId('record-compare-tab-change'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('change');
  });
});
