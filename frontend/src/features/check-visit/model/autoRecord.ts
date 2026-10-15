import type { VisitCheck } from '@/shared/api/index.schemas';

import type { AutoRevertPart } from '../ui/AutoRevertDialog';

/**
 * TRIP-1340 · 서버 VisitCheck 출처 → '자동 기록' 표식·되돌리기 대상(BR-U10-29~31). 기기 판정 상태를 쓰지 않는다.
 * 도착 출처(`source`)와 완료 출처(`completionSource`, TRIP-1409)는 따로다 — 완료가 있으면 완료 출처가 정한다.
 * - 완료 있음: 자동 완료(AUTO_*)면 COMPLETION("수동 도착 + 자동 완료" 포함). 수동·빈 완료는 서버가 VISIT_NOT_AUTO 로 거절하므로 표식 없음.
 * - 완료 없음: 자동 도착이면 ARRIVAL.
 */
export function autoRecordPart(
  visit: Pick<
    VisitCheck,
    'source' | 'completionSource' | 'arrivedAt' | 'completedAt' | 'skippedAt'
  >
): AutoRevertPart | null {
  if (visit.skippedAt) return null;
  if (visit.completedAt) {
    return visit.completionSource?.startsWith('AUTO_') ? 'COMPLETION' : null;
  }
  return visit.source === 'AUTO_GEOFENCE' && visit.arrivedAt ? 'ARRIVAL' : null;
}
