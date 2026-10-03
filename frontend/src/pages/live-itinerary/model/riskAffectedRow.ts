import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import { formatOpeningHoursLabel } from '@/entities/itinerary-slot/lib/openingHoursLabel';
import { parseSlotKey } from '@/entities/itinerary-slot/lib/slotKey';

/**
 * TRIP-749 · 트리거 slotKey → i03 위험 상세 시트 "영향 장소" 행.
 *
 * 날짜는 slotKey 안의 날짜로 찾는다(사용자가 고른 날이 아니다). 시각은 계획 `startAt` 을 자르기만
 * 한다(INV-2 · BR-U4-35). 못 찾으면 null — 시트가 행을 통째로 뺀다(G6). node-safe.
 */

export interface RiskAffectedRow {
  time: string;
  name: string;
  meta: string;
}

export function riskAffectedRow(
  days: { date: string; slots: ItineraryDaysItemSlotsItem[] }[],
  slotKey?: string | null
): RiskAffectedRow | null {
  if (!slotKey) return null;
  const parsed = parseSlotKey(slotKey);
  if (parsed.kind !== 'ok') return null;

  const slots = days.find((day) => day.date === parsed.date)?.slots ?? [];
  const index = slots.findIndex((slot) => slot.poiId === parsed.poiId);
  const slot = slots[index];
  if (!slot?.nameKo) return null;

  const meta = [
    `${index + 1}번째`,
    slot.category,
    formatOpeningHoursLabel(slot.openingHours),
  ]
    .filter((part) => part)
    .join(' · ');

  return { time: slot.startAt.slice(0, 5), name: slot.nameKo, meta };
}
