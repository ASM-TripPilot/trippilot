import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

type Slot = ItineraryDaysItemSlotsItem;

/**
 * TRIP-753 · 여행 중 편집(i07) 재정렬 규칙 — 고정(`isFixed`)이거나 방문 완료(`lockedPoiIds`) 행은
 * `original` 의 절대 index 에 남고, 나머지 칸은 끌기 결과(`reordered`)의 순서로 채운다(INV-U3-02).
 * `features/itinerary` 의 `reorderKeepingFixed` 와 같은 칸 채우기인데 잠금 목록을 함께 본다(형제
 * feature import 금지라 그 함수를 넓히지 않고 여기 둔다). 입력 배열은 바꾸지 않는다.
 */
export function reorderKeepingLocked(
  original: Slot[],
  reordered: Slot[],
  lockedPoiIds: string[]
): Slot[] {
  const pinned = (slot: Slot): boolean =>
    slot.isFixed || lockedPoiIds.includes(slot.poiId);
  const movable = reordered.filter((slot) => !pinned(slot));
  let cursor = 0;
  return original.map((slot) => {
    if (pinned(slot)) return slot;
    const next = movable[cursor];
    cursor += 1;
    return next;
  });
}
