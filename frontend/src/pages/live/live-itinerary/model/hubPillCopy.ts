import type {
  ItineraryDaysItemSlotsItem,
  Trigger,
} from '@/shared/api/index.schemas';

import { parseSlotKey } from '@/entities/itinerary-slot';
import { triggerDayLabel, triggerPillCopy } from '@/features/planb/index.view';

/**
 * 상황 감지 FE-B · frontend-components §3.4 · §8 — 허브 i02 알약 문구(판정은 여기, 허브 페이지는 배선 1줄).
 *
 * 장소는 트리거 **자기 날짜**의 슬롯에서 찾는다(`parseSlotKey` 의 날짜) — 허브가 다른 날을 보고 있어도 맞는 장소가
 * 나온다(`riskAffectedRow` 와 같은 규칙). 날짜어는 `affectedDate` 로 표시 시점에 만든다. 못 찾으면 라벨만(D2 폴백).
 * node-safe.
 */
function ownDaySlot(
  days: { date: string; slots: ItineraryDaysItemSlotsItem[] }[],
  slotKey?: string | null
): ItineraryDaysItemSlotsItem | undefined {
  if (!slotKey) return undefined;
  const parsed = parseSlotKey(slotKey);
  if (parsed.kind !== 'ok') return undefined;
  return days
    .find((day) => day.date === parsed.date)
    ?.slots.find((slot) => slot.poiId === parsed.poiId);
}

export function hubPillCopy(
  trigger: Trigger,
  days: { date: string; slots: ItineraryDaysItemSlotsItem[] }[],
  today: string
): string {
  return triggerPillCopy(trigger.kind, ownDaySlot(days, trigger.slotKey), {
    variant: trigger.variant,
    dayLabel: triggerDayLabel(trigger.affectedDate, today),
  });
}
