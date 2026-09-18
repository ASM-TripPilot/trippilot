import { fireEvent, render, screen } from '@testing-library/react-native';

import { StaySearchScreen } from './StaySearchScreen';

/**
 * e02 지역·필터 칩 실동작(TRIP-415) — `onPress={undefined}`이던 필터 칩을 콜백으로 잇는다.
 * 화면은 라우터·시트를 모른다(순수 프레젠테이션) — 누른 칩의 axis 를 `onPressFilter`로 넘기고,
 * 지역 재조회·필터 시트 열기는 `StaySearchPage`가 진다.
 *
 * 무엇을 보장하나:
 *  - 지역 칩·필터 칩을 누르면 `onPressFilter`가 그 axis 로 불린다(undefined 스텁이면 red).
 *  - 필터가 걸리면(activeFilterCount>0) '필터' 칩에 개수가 드러난다(AC: 선택됨이 칩에 보임).
 *  - 콜백 미지정(기존 2-prop 호출)이어도 눌러서 크래시하지 않는다(회귀 보호).
 */
describe('e02 필터 칩 배선 (TRIP-415)', () => {
  it('지역 칩·필터 칩을 누르면 onPressFilter 가 그 axis 로 불린다', () => {
    const onPressFilter = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={[]}
        onPressFilter={onPressFilter}
      />
    );

    fireEvent.press(screen.getByTestId('stay-search-filter-region'));
    fireEvent.press(screen.getByTestId('stay-search-filter-more'));

    expect(onPressFilter).toHaveBeenNthCalledWith(1, 'region');
    expect(onPressFilter).toHaveBeenNthCalledWith(2, 'more');
  });

  it('필터가 걸리면 "필터" 칩에 선택 개수가 드러난다', () => {
    render(<StaySearchScreen region="부산" items={[]} activeFilterCount={2} />);

    // '필터' 칩(more)에 개수 2가 보인다 — 선택됐음이 칩에 드러난다(AC).
    expect(screen.getByTestId('stay-search-filter-more')).toHaveTextContent(
      /2/
    );
  });

  it('필터가 0이면 개수 배지가 없다(선택 안 됨과 짝)', () => {
    render(<StaySearchScreen region="부산" items={[]} activeFilterCount={0} />);

    expect(screen.getByTestId('stay-search-filter-more')).not.toHaveTextContent(
      /\d/
    );
  });

  it('콜백 미지정이면 칩을 눌러도 아무 일이 없다(기존 호출 회귀 보호)', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    expect(() => {
      fireEvent.press(screen.getByTestId('stay-search-filter-region'));
      fireEvent.press(screen.getByTestId('stay-search-filter-more'));
    }).not.toThrow();
  });
});
