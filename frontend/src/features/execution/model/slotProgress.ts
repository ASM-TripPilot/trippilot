import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-395 · 슬롯 상태 사영 — 슬롯 목록에 "지금 어떤 단계인가"(완료·진행 중·예정) 라벨을 붙인다.
 *
 * 진행 상태는 **방문 기록**에서 온다(완료된 poiId · 현재 진행 poiId) — 시계로 도착 시각을
 * 재추정하지 않는다(BR-U4-34 · DEC-U4-9). 그래서 이 파일은 슬롯의 `startAt`/`endAt`을 읽지도
 * 연산하지도 않고, 슬롯 객체를 **그대로 통과**시킨다(PBT-U4-F1: 출력 시각 ⊆ 입력 시각).
 * i01 "기록 없음" 기본(빈 progress) = 전부 `upcoming`.
 */

export type SlotState = 'done' | 'active' | 'upcoming';

export interface ProjectedSlot {
  slot: ItineraryDaysItemSlotsItem;
  state: SlotState;
}

export interface SlotProgressInput {
  /** 방문 완료된 슬롯의 poiId 목록(115-B 이후 채워짐). 기본 없음 = 완료 0. */
  completedPoiIds?: readonly string[];
  /** 지금 진행 중인(도착했으나 미완료) 슬롯의 poiId. 기본 없음. */
  activePoiId?: string | null;
}

export function projectSlotProgress(
  slots: readonly ItineraryDaysItemSlotsItem[],
  progress: SlotProgressInput = {}
): ProjectedSlot[] {
  const completed = new Set(progress.completedPoiIds ?? []);
  const activePoiId = progress.activePoiId ?? null;

  return slots.map((slot) => {
    // 완료가 진행 중보다 우선한다 — 이미 방문한 곳은 여전히 진행 중일 수 없다.
    let state: SlotState = 'upcoming';
    if (completed.has(slot.poiId)) {
      state = 'done';
    } else if (activePoiId !== null && slot.poiId === activePoiId) {
      state = 'active';
    }
    return { slot, state };
  });
}
