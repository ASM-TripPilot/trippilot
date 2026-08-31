/**
 * TRIP-565 · AC-4 (INV-U5-01) — 방문 상태를 세 timestamp 에서만 파생한다.
 *
 * 서버가 status enum 컬럼을 두지 않는다(BR-U5-07). 클라도 저장된 상태 문자열을 만들거나
 * 읽지 않고, arrived/completed/skipped 세 시각의 유무만으로 4상태를 도출한다 — 입력 타입에
 * status 자리가 없어 구조적으로 status 를 못 읽는다.
 *
 * 우선순위: skipped > completed > arrived > upcoming (건너뜀이 완료를, 완료가 도착을 이긴다).
 * execution 의 `deriveVisitProgress`(poi 집계)와 규칙은 같되 shape 가 다르다(per-record 4상태).
 */

export type VisitStatus = 'UPCOMING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';

export function deriveVisitStatus(input: {
  arrivedAt?: string | null;
  completedAt?: string | null;
  skippedAt?: string | null;
}): VisitStatus {
  if (input.skippedAt != null) return 'SKIPPED';
  if (input.completedAt != null) return 'COMPLETED';
  if (input.arrivedAt != null) return 'IN_PROGRESS';
  return 'UPCOMING';
}
