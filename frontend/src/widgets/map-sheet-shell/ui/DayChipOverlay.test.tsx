import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  closestAncestor,
  closestScrollView,
  fireChipLayout,
  stubScrollTo,
} from '@/test-support/sheetTree';

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

// TRIP-1260 · 7일 여행에서 칩 줄이 잘리지 않게 칩만 가로 스크롤 안에 두고 back 은 고정한다.
// 셸 기본 오버레이(h08·h11·h14·h16)와 j01 기록이 이 컴포넌트 하나를 쓴다.
// ⚠️ 칩이 실제로 잘리는지·밀리는지는 6-b(jest 는 레이아웃을 계산하지 않는다).
describe('🔴 DayChipOverlay · 칩 줄 가로 스크롤', () => {
  const SEVEN_DAYS = Array.from({ length: 7 }, (_, index) => ({
    label: `${index + 1}일차`,
  }));

  function overlay(selectedIndex: number) {
    return (
      <DayChipOverlay
        days={SEVEN_DAYS}
        selectedIndex={selectedIndex}
        onSelectDay={jest.fn()}
        onBack={jest.fn()}
      />
    );
  }

  it('칩 7개는 한 가로 ScrollView 안에 있고, back 은 그 밖이며, 둘 다 sheet-daychip-root 안이다 (AC-1·AC-2·AC-4)', () => {
    render(overlay(0));

    const scroll = closestScrollView(screen.getByTestId('sheet-daychip-0'));
    expect(scroll?.props.horizontal).toBe(true);
    for (let index = 0; index < 7; index += 1) {
      expect(
        closestScrollView(screen.getByTestId(`sheet-daychip-${index}`))
      ).toBe(scroll);
    }
    const back = screen.getByTestId('sheet-daychip-back');
    expect(closestAncestor(back, (node) => node === scroll)).toBeNull();
    // 짝 — j01 테스트가 sheet-daychip-root 를 "칩 줄 전체"로 읽는다(back·칩을 계속 품어야 한다).
    const root = screen.getByTestId('sheet-daychip-root');
    expect(within(root).getByTestId('sheet-daychip-back')).toBe(back);
    expect(within(root).getByTestId('sheet-daychip-6')).toBeOnTheScreen();
  });

  it('선택을 6일차로 바꾸면 그 칩(x=400)이 보이게 0 < x ≤ 400 으로 scrollTo 한다 (AC-3)', () => {
    // 준비
    const view = render(overlay(0));
    const chip = screen.getByTestId('sheet-daychip-5');
    const scroll = closestScrollView(chip);
    expect(scroll).not.toBeNull();
    const scrollTo = stubScrollTo(scroll!);
    fireChipLayout(chip, 400);
    expect(scrollTo).not.toHaveBeenCalled();

    // 실행
    view.rerender(overlay(5));

    // 단언
    expect(scrollTo).toHaveBeenCalled();
    const target = scrollTo.mock.lastCall?.[0] as { x: number };
    expect(target.x).toBeGreaterThan(0);
    expect(target.x).toBeLessThanOrEqual(400);
  });
});
