import type { VisitCheck } from '@/shared/api/index.schemas';

import type { AutoRevertPart } from '../ui/AutoRevertDialog';

/**
 * TRIP-1340 · 서버 VisitCheck 출처 → '자동 기록' 표식·되돌리기 대상(BR-U10-29~31). 기기 판정 상태를 쓰지 않는다.
 * ⚠️ 현재 계약엔 `completion_source` 가 없다(§12 초안 미개통) — 도착 출처(`source`)가 AUTO_GEOFENCE 이면 자동으로 본다.
 * 완료가 있으면 되돌릴 부분은 완료, 없으면 도착(서버가 최종 판정 — 수동이면 409 VISIT_NOT_AUTO).
 */
export function autoRecordPart(
  visit: Pick<VisitCheck, 'source' | 'arrivedAt' | 'completedAt' | 'skippedAt'>
): AutoRevertPart | null {
  if (visit.source !== 'AUTO_GEOFENCE' || visit.skippedAt) return null;
  if (visit.completedAt) return 'COMPLETION';
  if (visit.arrivedAt) return 'ARRIVAL';
  return null;
}
