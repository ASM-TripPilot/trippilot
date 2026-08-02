import type { SavedPlace } from '@/shared/api/generated/schemas';

/**
 * poiId → savedPlaceId 역인덱스(TRIP-220 AC-5② · 01b Seed Q2·Q6). 카드의 하트는 poiId로
 * 그려지지만 해제 API는 savedPlaceId를 요구해서, `GET /saved-places` 응답을 뒤집어 찾는다.
 *
 * `null`을 돌려주는 세 경우(목록 미도착·미담김·낙관 표식)를 한 값으로 접는다 — 셋 다 호출자
 * 입장에서는 "보낼 id가 없다"로 같게 행동한다(01b Seed Q2가 갈래를 늘리지 않기로 결정).
 */
export function findSavedPlaceId(
  savedPlaces: SavedPlace[] | undefined,
  poiId: string
): string | null {
  const found = savedPlaces?.find((entry) => entry.place.poiId === poiId);
  if (!found || found.savedPlaceId === optimisticSavedPlaceId(poiId)) {
    return null;
  }
  return found.savedPlaceId;
}

/** 낙관 삽입 항목에 붙는 임시 표식 — 서버가 실제 id를 돌려주기 전까지 쓴다(01b Seed Q6). */
export function optimisticSavedPlaceId(poiId: string): string {
  return `optimistic:${poiId}`;
}
