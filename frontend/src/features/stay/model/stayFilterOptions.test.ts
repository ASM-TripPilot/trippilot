import type { StayItem } from '@/shared/api/generated/schemas';
import {
  buildStayFilterOptions,
  countActiveFilters,
  toggleFilterValue,
} from './stayFilterOptions';

/**
 * TRIP-415 — 필터 시트 옵션 도출 순수 함수.
 *
 * 무엇을 보장하나: 후보 목록은 결과 items 의 facet(편의시설·숙소유형)에서 나오고(값 창작 없음),
 * 이미 고른 값은 facet 에 없어도 항상 후보에 남으며(해제 가능 보장), selected 플래그가 선택
 * 상태를 정확히 반영한다.
 */

function item(
  amenities: string[],
  stayType: string
): Pick<StayItem, 'amenities' | 'stayType'> {
  return { amenities, stayType };
}

describe('buildStayFilterOptions', () => {
  it('결과 items 의 facet 을 중복 제거·정렬해 후보로 만든다', () => {
    const items = [item(['ocean', 'wifi'], 'HOTEL'), item(['wifi'], 'PENSION')];

    const options = buildStayFilterOptions(items, [], []);

    expect(options.amenities.map((o) => o.value)).toEqual(['ocean', 'wifi']);
    expect(options.stayTypes.map((o) => o.value)).toEqual(['HOTEL', 'PENSION']);
    // 아무것도 안 골랐으므로 selected 는 전부 false.
    expect(options.amenities.every((o) => !o.selected)).toBe(true);
  });

  it('고른 값은 facet 에 없어도 후보에 남고 selected=true 다(잘못 건 필터도 해제 가능)', () => {
    // 결과엔 ocean 뿐인데, 사용자가 예전에 pool 을 골라 결과가 줄어든 상황.
    const items = [item(['ocean'], 'HOTEL')];

    const options = buildStayFilterOptions(items, ['pool'], ['GUESTHOUSE']);

    expect(options.amenities.map((o) => o.value)).toEqual(['ocean', 'pool']);
    expect(options.amenities.find((o) => o.value === 'pool')?.selected).toBe(
      true
    );
    expect(options.amenities.find((o) => o.value === 'ocean')?.selected).toBe(
      false
    );
    // stayType 도 같은 규칙 — 결과엔 HOTEL 뿐이지만 고른 GUESTHOUSE 가 남는다.
    expect(options.stayTypes.map((o) => o.value)).toEqual([
      'GUESTHOUSE',
      'HOTEL',
    ]);
  });

  it('빈 문자열 facet 은 후보에서 빠진다', () => {
    const options = buildStayFilterOptions([item([], '')], [], []);
    expect(options.amenities).toEqual([]);
    expect(options.stayTypes).toEqual([]);
  });
});

describe('toggleFilterValue', () => {
  it('없으면 넣고 있으면 빼며, 원본 배열은 안 바꾼다', () => {
    const base = ['ocean'];

    const added = toggleFilterValue(base, 'wifi');
    expect(added).toEqual(['ocean', 'wifi']);

    const removed = toggleFilterValue(base, 'ocean');
    expect(removed).toEqual([]);

    // 원본 불변(새 배열 반환).
    expect(base).toEqual(['ocean']);
  });
});

describe('countActiveFilters', () => {
  it('편의시설·숙소유형 선택 개수를 합한다', () => {
    expect(countActiveFilters(['ocean', 'wifi'], ['HOTEL'])).toBe(3);
    expect(countActiveFilters([], [])).toBe(0);
  });
});
