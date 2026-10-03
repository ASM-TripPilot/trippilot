import type { VisitCheck, VisitCheckList } from '@/shared/api/index.schemas';
import { parseSlotKey } from '@/entities/itinerary-slot/lib/slotKey';

/**
 * TRIP-396 · AC-2 (US-ONTRIP-01) — 그 날 방문 기록에서 슬롯 진행 상태를 도출한다.
 * TRIP-1079 — **그 날짜의 계획 레코드**만 센다: slotKey 가 `{date}#{poiId}` 로 파싱되고 날짜
 * 조각이 `date` 인 것. 즉석 방문(slotKey 없음)·다른 날짜·깨진 키는 완료로도 active 로도 안 센다
 * (결정 1·2 — 서버 완료 잠금 `getCompletedSlots` 도 slotKey 기준이다). poi 는 slotKey 파싱값.
 *
 * 무엇을 보장하나:
 *  - `completedPoiIds` = 완료(completedAt≠null && skippedAt==null)한 poi — planOrder 순, 그 밖은
 *                        poiId 오름차순, 중복 없음.
 *  - `activePoiId`     = 도착·미완료·미건너뜀이면서 완료 목록에 없는 후보 중 **planOrder 에서 가장
 *                        앞선** poi. planOrder 밖 후보는 active 가 못 된다 → 항상 0~1개.
 *  - `visitCheckIdByPoiId` = active 레코드 1건의 poi→visitCheckId(같은 슬롯 후보가 둘이면 id 사전순 첫째).
 *  결과는 입력 목록 순서와 무관하다(서버 목록 정렬은 계약이 아니다). 도착 시각으로 고르지 않는다 —
 *  이 디렉토리는 시각 비교가 가드로 막혀 있고(BR-U4-34), 문자열 비교는 소수초·Z 없는 낙관 레코드에서
 *  순서가 뒤집힌다.
 *
 * 이 도출이 `projectSlotProgress(slots, {completedPoiIds, activePoiId})` 의 인자가 되어 i01 카드의
 * done/active/upcoming 을 가른다(브리프 데이터 흐름). 판정은 page 가 1회만 한다.
 */

export interface VisitProgress {
  completedPoiIds: string[];
  activePoiId: string | null;
  visitCheckIdByPoiId: Record<string, string>;
}

const isCompleted = (v: VisitCheck): boolean =>
  v.completedAt != null && v.skippedAt == null;

const isArrivedActive = (v: VisitCheck): boolean =>
  v.arrivedAt != null && v.completedAt == null && v.skippedAt == null;

export function deriveVisitProgress(
  list: VisitCheckList,
  date: string,
  planOrder: readonly string[]
): VisitProgress {
  // 그 날짜의 계획 레코드만 (poi = slotKey 파싱값).
  const planned: { poiId: string; v: VisitCheck }[] = [];
  for (const v of list.visits) {
    if (v.slotKey == null) continue;
    const parsed = parseSlotKey(v.slotKey);
    if (parsed.kind === 'ok' && parsed.date === date) {
      planned.push({ poiId: parsed.poiId, v });
    }
  }

  const completed = new Set(
    planned.filter((r) => isCompleted(r.v)).map((r) => r.poiId)
  );
  // 완료가 진행 중을 이긴다 — 완료 목록에 없는 도착 레코드만 active 후보.
  const candidates = planned.filter(
    (r) => isArrivedActive(r.v) && !completed.has(r.poiId)
  );

  const activePoiId =
    planOrder.find((poiId) => candidates.some((r) => r.poiId === poiId)) ??
    null;
  const visitCheckIdByPoiId: Record<string, string> = {};
  if (activePoiId !== null) {
    visitCheckIdByPoiId[activePoiId] = candidates
      .filter((r) => r.poiId === activePoiId)
      .map((r) => r.v.visitCheckId)
      .sort()[0];
  }

  // planOrder 순으로 꺼내고(Set.delete 는 있었으면 true — 중복도 한 번만), 남은 것은 오름차순.
  const rest = new Set(completed);
  const completedPoiIds = [
    ...planOrder.filter((poiId) => rest.delete(poiId)),
    ...[...rest].sort(),
  ];

  return { completedPoiIds, activePoiId, visitCheckIdByPoiId };
}
