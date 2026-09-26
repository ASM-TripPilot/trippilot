import { fireEvent, render, screen } from '@testing-library/react-native';

import { DayChipOverlay } from './DayChipOverlay';

/**
 * TRIP-991 · 지도 셸 좌상단 오버레이(뒤로 + 일차 칩)의 접근성.
 *
 * 무엇을 보장하나:
 *  - 뒤로 글리프 버튼이 VoiceOver 에 "뒤로" 버튼으로 읽힌다(AC-1·AC-2).
 *  - 일차 칩이 "N일차" 버튼으로 읽힌다(AC-1) — 선택 칩만 selected 다(AC-4).
 *
 * `toBeSelected()` 만으로는 역할 누락을 못 잡는다 — 그래서 역할·이름·상태를 `getByRole` 한 쿼리로 묻는다.
 * 3동작 뼈대: 준비=days·selectedIndex 주입 → 실행=render(+press) → 단언=역할·이름·상태·콜백.
 */

function renderOverlay() {
  const onSelectDay = jest.fn();
  const onBack = jest.fn();
  render(
    <DayChipOverlay
      days={[{ label: '1일차' }, { label: '2일차' }, { label: '3일차' }]}
      selectedIndex={1}
      onSelectDay={onSelectDay}
      onBack={onBack}
    />
  );
  return { onSelectDay, onBack };
}

describe('🔴 DayChipOverlay · TRIP-991 접근성', () => {
  it('뒤로 버튼은 "뒤로" 버튼으로 읽히고, 누르면 onBack 이 1회 불린다', () => {
    const { onBack } = renderOverlay();

    const back = screen.getByRole('button', { name: '뒤로' });
    expect(back).toHaveProp('testID', 'sheet-daychip-back');

    fireEvent.press(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('일차 칩은 "N일차" 버튼으로 읽히고, 누르면 그 순번으로 onSelectDay 가 불린다', () => {
    const { onSelectDay } = renderOverlay();

    ['1일차', '2일차', '3일차'].forEach((label, index) => {
      expect(screen.getByRole('button', { name: label })).toHaveProp(
        'testID',
        `sheet-daychip-${index}`
      );
    });

    fireEvent.press(screen.getByRole('button', { name: '3일차' }));
    expect(onSelectDay).toHaveBeenCalledWith(2);
  });

  it('역할을 붙여도 선택 칩만 selected 다 (선택 상태 보존)', () => {
    renderOverlay();

    expect(
      screen.getByRole('button', { name: '2일차', selected: true })
    ).toHaveProp('testID', 'sheet-daychip-1');
    expect(screen.getByRole('button', { name: '1일차' })).not.toBeSelected();
    expect(screen.getByRole('button', { name: '3일차' })).not.toBeSelected();
  });
});
