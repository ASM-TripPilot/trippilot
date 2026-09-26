import { useGetTripsTripIdReplanSessionsSessionIdDiff } from '@/shared/api/generated/replan/replan';

/**
 * TRIP-1007 · 재계획안 초안 조회(GET /trips/{tripId}/replan-sessions/{sessionId}/diff) 얇은 래퍼
 * (`useActiveTriggers` 동형, 로직 0줄). 초안이 아직 없으면 서버는 404 가 아니라 `ready=false` 로 준다.
 * 행 조립·이름 역조회는 페이지(`PlanbDraftPage`) 몫이다.
 *
 * `enabled` 로 초안(DRAFT) 얼굴에서만 조회한다 — 짜는 중·대안 없음에서 헛조회를 안 쏜다.
 */
export function useReplanDiff(
  tripId: string,
  sessionId: string,
  options?: { enabled?: boolean }
) {
  return useGetTripsTripIdReplanSessionsSessionIdDiff(tripId, sessionId, {
    query: { enabled: options?.enabled ?? true },
  });
}
