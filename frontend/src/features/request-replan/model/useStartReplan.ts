import { usePostTripsTripIdReplanSessions } from '@/shared/api/generated/trips/trips';

/**
 * TRIP-439 · AC-1 — 재계획 세션을 여는 POST(`/trips/{tripId}/replan-sessions`)의 얇은 래퍼.
 *
 * codegen `usePostTripsTripIdReplanSessions` 를 **그대로 반환**하는 순수 passthrough 다 —
 * 세션 열기는 무효화할 로컬 목록이 없어 `useQueryClient`·onSuccess 무효화를 두지 않는다
 * (`useCreateTrip` 의 무효화는 그 사유가 있어 뒀지만 여기엔 없다). 그래서 `.mutate` 변수 shape 은
 * codegen 그대로 `{ tripId, data }` 다.
 *
 * 페이지 통합 테스트가 이 seam 을 목해 "페이지가 `{ tripId, data }` 로 부른다"를 잠근다.
 */
export function useStartReplan(): ReturnType<
  typeof usePostTripsTripIdReplanSessions
> {
  return usePostTripsTripIdReplanSessions();
}
