import { StyleSheet } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { resetToastBottoms } from '@/shared/ui/toastBottom';

import { PlaceExploreScreen } from './PlaceExploreScreen';

/**
 * TRIP-1555 · 장소 탐색(d04) — 카드 목록(세로 FlatList)을 스크롤하는 동안 ♥·＋ FAB 숨김(홈 TRIP-1435 Q-023
 * 결정 1=A 와 같은 규칙). 훅 자체(디바운스·정리)는 `useScrollHide.test.ts` 가 맡고, 여기는 "FlatList 와 FAB
 * 래퍼에 이었는가"만 본다. 카테고리 칩 줄(가로)이 FAB 를 안 숨기는 것은 jest 로 못 잰다(`fireEvent.scroll` 이
 * 조상 onScroll 로 올라간다) → 6-b.
 *
 * 새 파일인 이유: 기존 `PlaceExploreScreen.test.tsx` 를 같은 기간 다른 레인이 수정 중이라 머지 충돌을 피한다 —
 * 그 레인이 머지되면 그 파일의 describe 로 합친다.
 *
 * pointerEvents·opacity 는 보이는 모양이 아니라 터치 통과 계약 + 숨김 자체다(02a ★5). FlatList 의 scroll
 * 이벤트는 `contentSize`·`layoutMeasurement` 가 없으면 VirtualizedList 가 throw 한다(02a ★3).
 */

// 토스트 바닥 레지스트리는 모듈 싱글턴 — 화면이 신고한 값이 다음 케이스로 새지 않게 파일 최상위에서 리셋한다.
afterEach(() => resetToastBottoms());
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function ui(extra: Partial<Parameters<typeof PlaceExploreScreen>[0]> = {}) {
  return (
    <PlaceExploreScreen
      places={[]}
      savedPoiIds={[]}
      selectedCategory={null}
      searchText=""
      onSelectCategory={jest.fn()}
      onChangeSearchText={jest.fn()}
      onToggleSave={jest.fn()}
      onPressCreateTrip={jest.fn()}
      {...extra}
    />
  );
}

// pointerEvents 와 opacity 가 같은 편을 들 때만 'hidden'/'shown' — 어긋나면 'mixed'(유령 FAB·터치 삼킴).
function fabVisibility(testID: string): 'hidden' | 'shown' | 'mixed' {
  const { pointerEvents, style } = screen.getByTestId(testID).props;
  const opacity = StyleSheet.flatten(style)?.opacity ?? 1;
  if (pointerEvents === 'none' && opacity === 0) return 'hidden';
  if (pointerEvents !== 'none' && opacity === 1) return 'shown';
  return 'mixed';
}
const scrollDown = () =>
  fireEvent.scroll(screen.getByTestId('explore-places-grid'), {
    nativeEvent: {
      contentOffset: { x: 0, y: 120 },
      contentSize: { width: 390, height: 5000 },
      layoutMeasurement: { width: 390, height: 800 },
    },
  });

describe('장소 탐색 — 스크롤하는 동안 FAB 숨김', () => {
  it('FAB 묶음이 ♥·＋ 를 감싸고, 처음엔 보인다(앵커)', () => {
    render(ui());

    const stack = screen.getByTestId('explore-places-fab-stack');
    expect(within(stack).getByTestId('explore-places-saved-fab')).toBeTruthy();
    expect(within(stack).getByTestId('explore-places-create-fab')).toBeTruthy();
    expect(fabVisibility('explore-places-fab-stack')).toBe('shown');
  });

  it('목록을 스크롤하면 숨고 터치를 막지 않으며, 멈춘 지 250ms 뒤에 다시 보인다', () => {
    render(ui());

    scrollDown();
    expect(fabVisibility('explore-places-fab-stack')).toBe('hidden');

    act(() => jest.advanceTimersByTime(249));
    expect(fabVisibility('explore-places-fab-stack')).toBe('hidden');

    act(() => jest.advanceTimersByTime(1));
    expect(fabVisibility('explore-places-fab-stack')).toBe('shown');
  });

  it('＋ 가 빠진 위저드 출처(hideCreateTrip)에서도 ♥ 묶음이 똑같이 숨었다 돌아온다', () => {
    render(ui({ hideCreateTrip: true }));
    // 앵커 — ＋ 는 없고 ♥ 만 묶음 안에 있다.
    expect(screen.queryByTestId('explore-places-create-fab') === null).toBe(
      true
    );
    expect(
      within(screen.getByTestId('explore-places-fab-stack')).getByTestId(
        'explore-places-saved-fab'
      )
    ).toBeTruthy();

    scrollDown();
    expect(fabVisibility('explore-places-fab-stack')).toBe('hidden');

    act(() => jest.advanceTimersByTime(250));
    expect(fabVisibility('explore-places-fab-stack')).toBe('shown');
  });
});
