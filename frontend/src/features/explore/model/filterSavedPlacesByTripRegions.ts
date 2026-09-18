import type { SavedPlace } from '@/shared/api/generated/schemas';

/**
 * 담은 장소 목록을 여행 지역으로 거른다(TRIP-689 · US-EXPL-04 · d02 후속).
 *
 * - `regions`가 비면 목록을 그대로 돌려준다(무필터).
 * - 각 place의 지역이 어떤 여행 지역과 **양방향 접두사**로 겹치면 표시, 아니면 숨김.
 * - **fail-open**: place 지역이 null·빈값이거나 확신 매칭이 안 되는 애매값은 숨기지 않는다
 *   (담아둔 장소를 잘못 감추는 것이 최악이라는 제품 결정, 01b OQ-2·OQ-4).
 *
 * 정규화(축약·시/도 단위 환산)는 발명하지 않는다 — TRIP-690 몫(형식 실측 후 완성).
 */
export function filterSavedPlacesByTripRegions(
  saved: SavedPlace[],
  regions: string[]
): SavedPlace[] {
  if (regions.length === 0) return saved;
  return saved.filter((entry) => regionMatches(entry.place.region, regions));
}

function regionMatches(
  placeRegion: string | null | undefined,
  tripRegions: string[]
): boolean {
  const p = (placeRegion ?? '').trim();
  if (p === '') return true; // fail-open: 지역 미상 → 숨기지 않는다.
  return tripRegions.some((r) => {
    const t = r.trim();
    // 빈 여행 지역("")은 매칭 근거가 못 된다 — `'경주시'.startsWith('')`는 true라
    // 이 가드가 없으면 빈 지역 하나가 모든 place를 통과시켜 필터가 죽는다.
    if (t === '') return false;
    return p.startsWith(t) || t.startsWith(p);
  });
}
