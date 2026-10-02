import type { StayItem } from '@/shared/api/generated/schemas';

/**
 * e02 필터 시트 옵션 도출(TRIP-415) — 순수 함수.
 *
 * 계약(`GetStaysSearchParams`)의 `amenity`·`stayType`은 enum 이 없는 **자유 문자열 배열**이라
 * 후보 목록의 정본 출처가 없다. 그래서 값을 창작하지 않고 **지금 결과에 실재하는 facet**
 * (`items[].amenities`·`items[].stayType`)에 **이미 고른 값**을 합집합해 후보로 쓴다.
 * 선택값을 항상 포함하는 이유: 필터로 결과가 0건에 가까워져 facet 이 사라져도 해제할 수 있어야
 * 한다(안 그러면 잘못 건 필터에 갇힌다).
 *
 * ponytail: facet 파생의 천장 — 한 번 좁히면 그 결과에 없는 새 필터값은 시트에서 발견 못 한다
 * (좁히기·해제만 가능, code-critic N-3). 계약에 amenity/stayType enum 이 생기거나 서버가
 * facet 카탈로그를 주면 그 정본 목록으로 바꾼다(그때 이 함수의 입력이 items→카탈로그가 된다).
 */

export interface StayFilterOption {
  value: string;
  selected: boolean;
}

export interface StayFilterOptions {
  amenities: StayFilterOption[];
  stayTypes: StayFilterOption[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))].sort();
}

export function buildStayFilterOptions(
  items: Pick<StayItem, 'amenities' | 'stayType'>[],
  selectedAmenities: string[],
  selectedStayTypes: string[]
): StayFilterOptions {
  const amenityValues = uniqueSorted([
    ...items.flatMap((it) => it.amenities ?? []),
    ...selectedAmenities,
  ]);
  const stayTypeValues = uniqueSorted([
    ...items.map((it) => it.stayType),
    ...selectedStayTypes,
  ]);
  return {
    amenities: amenityValues.map((value) => ({
      value,
      selected: selectedAmenities.includes(value),
    })),
    stayTypes: stayTypeValues.map((value) => ({
      value,
      selected: selectedStayTypes.includes(value),
    })),
  };
}

/** 값 하나를 토글한다(있으면 빼고, 없으면 넣는다) — 원본 배열은 안 바꾼다(새 배열 반환). */
export function toggleFilterValue(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

/** 적용된 필터 총 개수 — '필터' 칩 배지에 쓴다. */
export function countActiveFilters(
  amenities: string[],
  stayTypes: string[]
): number {
  return amenities.length + stayTypes.length;
}
