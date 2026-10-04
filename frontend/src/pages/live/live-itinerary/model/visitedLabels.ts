import { parseSlotKey } from '@/entities/itinerary-slot';
import type { VisitCheckList } from '@/shared/api/index.schemas';
import { seoulTime } from '@/shared/lib/seoulDate';

/**
 * TRIP-1220 — 허브 방문 완료 카드의 시각 라벨. 정본은 **실제 시각**(서버 arrivedAt — 기록 j01 과 같은 값)이다.
 * 그 날짜의 계획 레코드 중 완료(completedAt≠null · 건너뜀 아님)이고 arrivedAt 이 있는 poi 만 담는다 —
 * 없으면 키가 없고 카드는 계획 시각으로 표시한다. 시계는 읽지 않는다(`new Date(iso)` 는 파싱).
 */
export function visitedLabelByPoiId(
  list: VisitCheckList,
  date: string
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const v of list.visits) {
    if (v.slotKey == null || v.completedAt == null || v.skippedAt != null)
      continue;
    // 낙관 레코드(`optimistic:` id)의 시각은 자리표시자(날짜T00:00:00)라 실제 시각이 아니다 — 재조회로 서버 값이 올 때까지 계획 시각.
    if (!v.arrivedAt || v.visitCheckId.startsWith('optimistic:')) continue;
    const parsed = parseSlotKey(v.slotKey);
    if (parsed.kind !== 'ok' || parsed.date !== date) continue;
    const at = new Date(v.arrivedAt);
    if (Number.isNaN(at.getTime())) continue;
    labels[parsed.poiId] = seoulTime(at);
  }
  return labels;
}
