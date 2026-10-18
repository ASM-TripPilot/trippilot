import { parseSlotKey } from '@/entities/itinerary-slot';
import type { VisitCheckList } from '@/shared/api/index.schemas';

/**
 * TRIP-1203 — 허브 방문 완료 카드의 [사진]·[메모]가 POST/PUT 할 방문 id(poi → visitCheckId).
 * 필터는 시각 라벨(entities `visitedLabelByPoiId`)과 같고 arrivedAt 조건만 없다(시각이 없는 완료에도 기록은 남긴다). 낙관 레코드(`optimistic:`)
 * id 는 서버가 모르므로(404) 뺀다. 같은 poi 가 둘이면 id 사전순 첫째(deriveVisitProgress 규칙 — 목록 순서는 계약 아님).
 */
export function doneVisitCheckIdByPoiId(
  list: VisitCheckList,
  date: string
): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const v of list.visits) {
    if (v.slotKey == null || v.completedAt == null || v.skippedAt != null)
      continue;
    if (v.visitCheckId.startsWith('optimistic:')) continue;
    const parsed = parseSlotKey(v.slotKey);
    if (parsed.kind !== 'ok' || parsed.date !== date) continue;
    const prev = ids[parsed.poiId];
    if (prev === undefined || v.visitCheckId < prev)
      ids[parsed.poiId] = v.visitCheckId;
  }
  return ids;
}
