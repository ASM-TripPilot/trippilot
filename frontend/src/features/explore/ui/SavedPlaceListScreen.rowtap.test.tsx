import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import { SavedPlaceListScreen } from './SavedPlaceListScreen';

/**
 * TRIP-456 · AC-3 — d02 담은 장소 행 press 버블링 갈림(화면 층).
 *
 * 무엇을 보장하나: 행을 `Pressable`로 만들어 d06으로 배선하되, **하트(해제) press가 행으로 새지
 * 않는다**. d02 하트는 `disabled`가 없어 항상 활성이라, RNTL에서 활성 자식은 press를 잡아 부모로
 * 안 샌다(Probe A, 02a §5 실측) — d04와 달리 대기 누수(Probe C) 위험이 없다. 그래도 양·음 짝으로
 * "행 탭은 이동, 하트 탭은 해제"의 갈림을 잠근다.
 */

function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '문화',
    lat: 35.1,
    lng: 129.1,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 5,
    dataStatus: 'ACTIVE',
  };
}

// 행 키(savedPlaceId)와 place.poiId를 일부러 다르게 둔다 — AC-2(배선)와 같은 규율.
const SAVED: SavedPlace[] = [
  {
    savedPlaceId: 'sp-1',
    savedAt: '2026-08-01T00:00:00Z',
    place: makePlace('p9', '감천문화마을'),
  },
];

function renderScreen(overrides?: {
  onPressRow?: (saved: SavedPlace) => void;
  onPressRemove?: (saved: SavedPlace) => void;
}) {
  render(
    <SavedPlaceListScreen
      savedPlaces={SAVED}
      onPressRemove={overrides?.onPressRemove ?? (() => {})}
      onPressCreateTrip={() => {}}
      onPressBrowse={() => {}}
      onPressRow={overrides?.onPressRow}
    />
  );
}

describe('AC-3 · d02 행 press 버블링', () => {
  it('C4 행 본문을 누르면 onPressRow(saved)가 그 행의 saved로 불린다', () => {
    // 준비 — 행 1개, onPressRow 스파이.
    const onPressRow = jest.fn();
    const onPressRemove = jest.fn();
    renderScreen({ onPressRow, onPressRemove });

    // 실행 — 행 루트(savedPlaceId testID)를 누른다.
    fireEvent.press(screen.getByTestId('explore-saved-item-sp-1'));

    // 단언 — 그 행의 saved가 올라간다. 해제 콜백은 안 불린다.
    expect(onPressRow).toHaveBeenCalledTimes(1);
    expect(onPressRow.mock.calls[0][0].savedPlaceId).toBe('sp-1');
    expect(onPressRemove).not.toHaveBeenCalled();
  });

  it('C5 활성 하트를 누르면 onPressRemove만 불리고 onPressRow로 안 샌다 (Probe A)', () => {
    // 준비 — d02 하트는 disabled 없음(항상 활성).
    const onPressRow = jest.fn();
    const onPressRemove = jest.fn();
    renderScreen({ onPressRow, onPressRemove });

    // 실행 — 하트(해제)를 누른다.
    fireEvent.press(screen.getByTestId('explore-saved-remove-sp-1'));

    // 단언 — 해제만 반응, 행 이동으로 안 샌다.
    expect(onPressRemove).toHaveBeenCalledTimes(1);
    expect(onPressRemove.mock.calls[0][0].savedPlaceId).toBe('sp-1');
    expect(onPressRow).not.toHaveBeenCalled();
  });
});
