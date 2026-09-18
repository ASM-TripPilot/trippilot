import type { SavedStay, StayItem } from '@/shared/api/generated/schemas';

/**
 * (externalSource, externalId) → savedStayId 역인덱스(TRIP-417 AC-2·AC-3 · Q6). 카드의 하트는
 * 검색결과 `StayItem`(외부키만 있다)로 그려지지만 해제 API는 담기 기록의 `savedStayId`를
 * 요구해서, `GET /saved-stays` 응답을 뒤집어 찾는다. explore d04 `savedPlaceIndex.ts`의 stay 판 —
 * 매칭 키만 poiId → (externalSource+externalId) 짝으로 다르다.
 *
 * `null`을 돌려주는 세 경우(목록 미도착·미담김·낙관 표식)를 한 값으로 접는다 — 셋 다 호출자
 * 입장에서는 "보낼 id가 없다"로 같게 행동한다(01b Seed Q6 — 갈래를 늘리지 않기로 결정).
 *
 * 매칭이 두 값 strict 등가라, 외부키가 null인 SavedStay(핀·수동 등록)는 검색결과 item의
 * non-null 외부키와 결코 같지 않아 자동으로 탈락한다("NAVER" !== null) — 별도 null 가드가 없다.
 */
export function findSavedStayId(
  savedStays: SavedStay[] | undefined,
  item: Pick<StayItem, 'externalSource' | 'externalId'>
): string | null {
  const found = savedStays?.find(
    (entry) =>
      entry.externalSource === item.externalSource &&
      entry.externalId === item.externalId
  );
  if (
    !found ||
    found.savedStayId ===
      optimisticSavedStayId(`${item.externalSource}:${item.externalId}`)
  ) {
    return null;
  }
  return found.savedStayId;
}

/** 낙관 삽입 항목에 붙는 임시 표식 — 서버가 실제 id를 돌려주기 전까지 쓴다(01b Seed Q6).
 * key = `stayKey(item)` = `${externalSource}:${externalId}`. */
export function optimisticSavedStayId(key: string): string {
  return `optimistic:${key}`;
}
