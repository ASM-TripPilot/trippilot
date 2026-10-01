import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { PRICE_BUCKETS, type PriceBucketId } from '../model/priceRangeFilter';
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

/** 칩 라벨은 가격대 시트와 같은 출처(PRICE_BUCKETS)에서 온다 — 시트에서 고른 이름이 칩에 그대로 뜬다. */
function bucketLabel(id: PriceBucketId): string {
  const label = PRICE_BUCKETS.find((bucket) => bucket.id === id)?.label;
  if (!label) throw new Error(`PRICE_BUCKETS 에 ${id} 가 없다`);
  return label;
}

/**
 * TRIP-989 E-1 — 가격대를 골라도 칩이 그대로라 "적용됐는지" 알 수 없었다(Figma e02 에도 이 얼굴이
 * 없다 — 01b Q2 로 새로 정함). 적용되면 라벨이 고른 가격대 이름으로 바뀌고, 선택 신호
 * (`accessibilityState.selected`)와 기존 활성 색(`primary-pale`, d04 정렬 칩과 같은 토큰)을 갖는다.
 */
describe('e02 가격대 칩 활성 얼굴 (TRIP-989 E-1 · US-STAY-02)', () => {
  it('가격대가 적용되면 칩이 그 가격대 이름을 보이고 선택됨·연핑크가 된다', () => {
    render(
      <StaySearchScreen region="부산" items={[]} priceBucket="under-100k" />
    );

    const chip = screen.getByTestId('stay-search-filter-price');
    expect(chip).toBeSelected();
    expect(within(chip).getByText(bucketLabel('under-100k'))).toBeOnTheScreen();
    expect(within(chip).queryByText('가격대')).toBeNull();
    expect(String(chip.props.className)).toContain('primary-pale');
  });

  it.each([['all' as const], [undefined]])(
    '짝: 가격대가 %s 이면 칩은 "가격대" 그대로이고 선택되지 않았다',
    (priceBucket) => {
      render(
        <StaySearchScreen region="부산" items={[]} priceBucket={priceBucket} />
      );

      const chip = screen.getByTestId('stay-search-filter-price');
      expect(chip).not.toBeSelected();
      expect(within(chip).getByText('가격대')).toBeOnTheScreen();
      expect(String(chip.props.className)).not.toContain('primary-pale');
    }
  );
});
