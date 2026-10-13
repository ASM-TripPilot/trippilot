/**
 * TRIP-1073 B · 후보 목록에서 선택 상태로 둘 poiId — 사용자가 직접 탭한 후보가 지금 목록에 있으면
 * 그것, 아니면 첫 후보(A), 후보가 없으면 null(결정 2 (a)). 결과는 늘 지금 목록 안이다(INV-1).
 * 호출처는 **탭한 poiId 만** 넘긴다 — 자동 선택된 A 는 사용자 선택이 아니라 재조회 때 새 A 가 된다.
 */
export function resolveCandidateSelection(
  candidates: readonly { poiId: string }[],
  tappedPoiId: string | null
): string | null {
  if (candidates.some((candidate) => candidate.poiId === tappedPoiId)) {
    return tappedPoiId;
  }
  return candidates[0]?.poiId ?? null;
}
