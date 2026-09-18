import type {
  VisitCheck,
  VisitCheckList,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-396 · AC-2 (US-ONTRIP-01) — 그 날 방문 기록에서 슬롯 진행 상태를 도출한다.
 *
 * 무엇을 보장하나:
 *  - `completedPoiIds` = 완료(completedAt≠null && skippedAt==null)한 poiId 들.
 *  - `activePoiId`     = 도착·미완료(arrivedAt≠null && completedAt==null && skippedAt==null)이면서
 *                        **완료 목록에 없는** poiId — 완료가 진행 중을 이긴다(같은 poiId 두 레코드).
 *  - `visitCheckIdByPoiId` = active 레코드의 poiId→visitCheckId(완료 호출에 실을 id).
 *  건너뜀(skippedAt)은 어디에도 안 들어가고, 즉석 방문(slotKey=null)도 도착이면 active 로 잡힌다.
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

export function deriveVisitProgress(list: VisitCheckList): VisitProgress {
  const completedPoiIds: string[] = [];
  for (const v of list.visits) {
    if (isCompleted(v) && !completedPoiIds.includes(v.poiId)) {
      completedPoiIds.push(v.poiId);
    }
  }

  // 완료가 진행 중을 이긴다 — 완료 목록에 없는 도착 레코드만 active 후보.
  let activePoiId: string | null = null;
  const visitCheckIdByPoiId: Record<string, string> = {};
  for (const v of list.visits) {
    if (isArrivedActive(v) && !completedPoiIds.includes(v.poiId)) {
      activePoiId = v.poiId;
      visitCheckIdByPoiId[v.poiId] = v.visitCheckId;
    }
  }

  return { completedPoiIds, activePoiId, visitCheckIdByPoiId };
}
