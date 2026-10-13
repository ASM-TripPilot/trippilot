import { ScrollView } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { PlaceExploreScreen } from './PlaceExploreScreen';

/**
 * TRIP-1221(b) · 카테고리 시트로 고른 칩이 화면 밖이면 칩 줄이 그 칩까지 스크롤한다.
 * 0건 안내는 검색어·카테고리가 둘 다 걸렸을 때 숨은 필터도 말한다.
 */
function ui(selectedCategory: '쇼핑' | null, extra = {}) {
  return (
    <PlaceExploreScreen
      places={[]}
      savedPoiIds={[]}
      selectedCategory={selectedCategory}
      searchText=""
      onSelectCategory={jest.fn()}
      onChangeSearchText={jest.fn()}
      onToggleSave={jest.fn()}
      onPressCreateTrip={jest.fn()}
      {...extra}
    />
  );
}

describe('카테고리 칩 줄 스크롤', () => {
  it('선택이 바뀌면 그 칩의 x 위치로 scrollTo 한다', () => {
    const view = render(ui(null));
    const chips = screen.UNSAFE_getAllByType(ScrollView);
    const strip = chips.find((n) => n.props.horizontal)!;
    const scrollTo = jest.fn();
    (strip.instance as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    fireEvent(
      screen.getByTestId('explore-places-category-shopping'),
      'layout',
      {
        nativeEvent: { layout: { x: 400, y: 0, width: 60, height: 36 } },
      }
    );

    view.rerender(ui('쇼핑'));

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0][0].x).toBeGreaterThan(0);
    expect(scrollTo.mock.calls[0][0].x).toBeLessThanOrEqual(400);
  });
});

describe('filter-zero · 숨은 카테고리 필터', () => {
  it('검색어와 카테고리가 둘 다 걸리면 카테고리 필터가 걸려 있다고 말한다', () => {
    render(
      ui('쇼핑', {
        searchText: '경복궁',
        state: { kind: 'filter-zero', blame: 'search' },
      })
    );
    const notice = screen.getByTestId('explore-places-filterzero');
    expect(within(notice).getByText(/‘쇼핑’ 필터/)).toBeOnTheScreen();
  });

  it('검색어만 걸리면 카테고리 문구는 없다', () => {
    render(
      ui(null, {
        searchText: '경복궁',
        state: { kind: 'filter-zero', blame: 'search' },
      })
    );
    const notice = screen.getByTestId('explore-places-filterzero');
    expect(within(notice).queryByText(/필터가 함께/)).toBeNull();
  });
});
