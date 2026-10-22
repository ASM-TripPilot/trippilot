import type { Place } from '@/shared/api/index.schemas';

/**
 * 지역별로 따로 받아온 여러 `Place[]` 목록을 하나로 합친다(다지역 '꼭 갈 곳 더 담기', TRIP-687).
 *
 * - 입력 순서대로 평탄화하되, 같은 `poiId` 는 **첫 등장 하나만** 남긴다(순서 보존).
 * - **새 배열**을 돌려준다 — TanStack Query 캐시가 소유한 배열을 제자리 정렬해 캐시를 망치지 않게.
 * - 항목의 값은 손대지 않는다(참조를 그대로 담을 뿐, 지역명 등 원문 유지).
 */
export function mergePlacesByPoiId(lists: Place[][]): Place[] {
  const seen = new Set<string>();
  const merged: Place[] = [];
  for (const list of lists) {
    for (const place of list) {
      if (seen.has(place.poiId)) continue;
      seen.add(place.poiId);
      merged.push(place);
    }
  }
  return merged;
}

/**
 * 지역별 목록을 **라운드 로빈**으로 교차해 하나로 합친다(d04 시드 무작위 순서, TRIP-1563).
 *
 * - 라운드 j 에 "길이가 j+1 이상인 리스트들의 j 번째"를 리스트 순서대로 한 개씩 담는다(소진된 리스트는 건너뜀).
 * - 같은 `poiId` 는 이 교차 순서상 먼저 나온 하나만 남긴다.
 * - 사진 유무는 보지 않는다. 새 배열을 돌려주고 입력은 건드리지 않는다.
 */
export function interleavePlacesByRegion(lists: Place[][]): Place[] {
  const rounds = Math.max(0, ...lists.map((list) => list.length));
  const seen = new Set<string>();
  const merged: Place[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const list of lists) {
      const place = list[round];
      if (!place || seen.has(place.poiId)) continue;
      seen.add(place.poiId);
      merged.push(place);
    }
  }
  return merged;
}
