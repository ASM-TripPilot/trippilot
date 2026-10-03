import { usePostTripsTripIdReplanSessionsSessionIdCancel } from '@/shared/api/generated/trips/trips';

/**
 * TRIP-441 · AC-4 · INV-U4-05 — 재계획 **취소(cancel)** 배선의 얇은 래퍼.
 *
 * codegen `usePostTripsTripIdReplanSessionsSessionIdCancel` 을 **그대로 반환**하는 순수
 * passthrough 다(`useStartReplan` 선례). 취소는 세션만 `CANCELED` 로 닫을 뿐 원 일정을 한 줄도
 * 바꾸지 않으므로(INV-U4-05) **무효화가 없다** — apply(`useApplyReplan`)가 무효화를 두는 것과
 * 반대다. 성공 후 항법(→live)은 라우터를 아는 페이지가 `.mutate(vars, { onSuccess })` 로 건다
 * (모델은 라우터를 모른다).
 */
export function useCancelReplan(): ReturnType<
  typeof usePostTripsTripIdReplanSessionsSessionIdCancel
> {
  return usePostTripsTripIdReplanSessionsSessionIdCancel();
}
