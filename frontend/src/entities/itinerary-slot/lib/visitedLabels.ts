import type { VisitCheck, VisitCheckList } from '@/shared/api/index.schemas';
import { parseSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { seoulTime } from '@/shared/lib/seoulDate';

/**
 * TRIP-1419 — 방문 기록 한 건의 **실제 도착 시각**(서버 arrivedAt → KST 'HH:mm'). 완료 여부는 보지 않는다 —
 * 허브 관람 중 카드도 이 값을 쓴다. 시각이 없거나 · 파싱이 안 되거나 · 낙관 레코드면 `null`.
 * 낙관 레코드(`optimistic:` id)의 시각은 자리표시자(날짜T00:00:00)라 실제 시각이 아니다. 접두 상수는
 * features/check-visit 에 있어 이 층에서 못 불러 문자열로 쓴다. 시계는 읽지 않는다(`new Date(iso)` 는 파싱).
 */
export function arrivedLabel(visit: VisitCheck): string | null {
  if (!visit.arrivedAt || visit.visitCheckId.startsWith('optimistic:'))
    return null;
  const at = new Date(visit.arrivedAt);
  return Number.isNaN(at.getTime()) ? null : seoulTime(at);
}

/**
 * TRIP-1220 — 방문 완료 카드(허브)·완료 행(재계획 진행 화면, TRIP-1419)의 시각 라벨. 정본은 **실제 시각**
 * (서버 arrivedAt — 기록 j01 과 같은 값)이다. 그 날짜의 계획 레코드 중 완료(completedAt≠null · 건너뜀 아님)이고
 * 실제 시각이 있는 poi 만 담는다 — 없으면 키가 없고 화면은 계획 시각으로 표시한다.
 */
export function visitedLabelByPoiId(
  list: VisitCheckList,
  date: string
): Record<string, string> {
  // TRIP-1495 — 같은 poi 에 완료 기록이 둘이면 대표는 id 사전순 첫째다(허브 [사진]·[메모] 대상
  // `doneVisitCheckIdByPoiId` 와 같은 규칙 — 목록 순서는 계약이 아니다). 시각의 주인 = 기록 대상. 낙관 레코드는 뺀다.
  const owner: Record<string, VisitCheck> = {};
  for (const v of list.visits) {
    if (v.slotKey == null || v.completedAt == null || v.skippedAt != null)
      continue;
    if (v.visitCheckId.startsWith('optimistic:')) continue;
    const parsed = parseSlotKey(v.slotKey);
    if (parsed.kind !== 'ok' || parsed.date !== date) continue;
    const prev = owner[parsed.poiId];
    if (prev === undefined || v.visitCheckId < prev.visitCheckId)
      owner[parsed.poiId] = v;
  }
  const labels: Record<string, string> = {};
  for (const [poiId, v] of Object.entries(owner)) {
    const label = arrivedLabel(v);
    if (label !== null) labels[poiId] = label;
  }
  return labels;
}
