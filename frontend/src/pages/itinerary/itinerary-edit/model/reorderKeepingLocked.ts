import type { ItineraryDaysItemSlotsItem } from '@/shared/api/index.schemas';

type Slot = ItineraryDaysItemSlotsItem;

/**
 * TRIP-753 · 여행 중 편집(i07) 재정렬 규칙 — 방문 완료(`lockedPoiIds`) 행은 `original` 의 절대 index 에
 * 남고, 나머지 칸은 끌기 결과(`reordered`)의 순서로 채운다. 시각 고정(`isFixed`) 행은 잠그지 않는다 —
 * 고정은 시각만 지키고(INV-U3-03, 서버가 저장 때 지킴) 순서 자리는 끌기 결과를 따른다(TRIP-1250).
 * 입력 배열은 바꾸지 않는다.
 */
export function reorderKeepingLocked(
  original: Slot[],
  reordered: Slot[],
  lockedPoiIds: string[]
): Slot[] {
  const pinned = (slot: Slot): boolean => lockedPoiIds.includes(slot.poiId);
  const movable = reordered.filter((slot) => !pinned(slot));
  let cursor = 0;
  return original.map((slot) => {
    if (pinned(slot)) return slot;
    const next = movable[cursor];
    cursor += 1;
    return next;
  });
}
