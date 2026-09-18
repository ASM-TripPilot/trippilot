import type { Place } from '@/shared/api/generated/schemas';

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
