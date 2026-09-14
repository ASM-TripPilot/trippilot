import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-443 · shared 승격(공용 편집 로직) — 비고정만 재정렬, 고정은 원래 절대 인덱스 재고정.
 * `features/itinerary/model/itineraryEditStore.ts`의 동명 함수와 계약 동형이나 features 경계
 * (planb는 U3 직접 import 금지)로 shared에 별도 신설한다(리포 로컬 복제 관례).
 *
 * lib(`onDragEnd.data`)이 준 배열이 고정을 밀어냈어도, 고정은 `original`의 자리를 지키고 비고정만
 * `reordered` 순서로 빈 자리를 채운다(BR-U4-44·BR-U4-18 — 숙소 체크인/완료 슬롯 자리 잠금).
 */
type Slot = ItineraryDaysItemSlotsItem;

export function reorderKeepingFixed(
  original: Slot[],
  reordered: Slot[]
): Slot[] {
  const nonFixedInOrder = reordered.filter((s) => !s.isFixed);
  const result: Slot[] = new Array(original.length);
  let cursor = 0;
  for (let i = 0; i < original.length; i += 1) {
    if (original[i].isFixed) {
      result[i] = original[i];
    } else {
      result[i] = nonFixedInOrder[cursor];
      cursor += 1;
    }
  }
  return result;
}
