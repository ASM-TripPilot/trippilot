import { FlatList } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import type { Place } from '@/shared/api/index.schemas';
import { PlaceSubtitle } from '@/entities/place/ui/PlaceSubtitle';

import { PlaceExploreScreen } from './PlaceExploreScreen';

/**
 * TRIP-1349 — d04 검색 키 입력(searchText 만 바뀜)에 이미 마운트된 카드가 재렌더되지 않고, 세퍼레이터
 * 컴포넌트 타입이 같아(= remount 안 됨) 야 한다. 렌더 횟수는 카드 안 PlaceSubtitle 호출 수로 대신 센다.
 * 실제 커밋 횟수는 Profiler(PR 본문).
 */
jest.mock('@/entities/place/ui/PlaceSubtitle', () => {
  const actual = jest.requireActual('@/entities/place/ui/PlaceSubtitle');
  return {
    PlaceSubtitle: jest.fn((props: unknown) => actual.PlaceSubtitle(props)),
  };
});

function place(poiId: string): Place {
  return {
    poiId,
    nameKo: `장소 ${poiId}`,
    category: '명소',
    lat: 35.1,
    lng: 129.1,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  } as Place;
}

const PLACES = [place('a'), place('b'), place('c'), place('d')];
const SAVED = ['a'];
const noop = jest.fn();
const calls = (): number =>
  (PlaceSubtitle as unknown as jest.Mock).mock.calls.length;

function ui(searchText: string, saved: string[] = SAVED) {
  return (
    <PlaceExploreScreen
      places={PLACES}
      savedPoiIds={saved}
      selectedCategory={null}
      searchText={searchText}
      onSelectCategory={noop}
      onChangeSearchText={noop}
      onToggleSave={noop}
      onPressCard={noop}
      onPressCreateTrip={noop}
    />
  );
}

describe('TRIP-1349 · d04 그리드 렌더 핫스팟', () => {
  beforeEach(() => (PlaceSubtitle as unknown as jest.Mock).mockClear());

  it('R1 · 검색어만 바뀌면 마운트된 카드는 재렌더되지 않는다', () => {
    const { rerender } = render(ui(''));
    expect(screen.getAllByTestId(/^explore-places-card-/)).toHaveLength(4);
    const before = calls();
    rerender(ui('해'));
    rerender(ui('해운'));
    expect(calls()).toBe(before);
  });

  it('R2 · 담김 목록이 바뀌면 그 카드는 갱신된다(stale 금지)', () => {
    const { rerender } = render(ui(''));
    expect(screen.getByTestId('explore-places-save-b')).not.toBeSelected();
    rerender(ui('', ['a', 'b']));
    expect(screen.getByTestId('explore-places-save-b')).toBeSelected();
  });

  it('R3 · ItemSeparatorComponent 참조가 렌더 간 같다(인라인 화살표 아님)', () => {
    const { rerender } = render(ui(''));
    const first =
      screen.UNSAFE_getByType(FlatList).props.ItemSeparatorComponent;
    rerender(ui('해'));
    expect(screen.UNSAFE_getByType(FlatList).props.ItemSeparatorComponent).toBe(
      first
    );
  });
});
