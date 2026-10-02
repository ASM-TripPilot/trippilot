import { useQueryClient } from '@tanstack/react-query';

import {
  getGetTripsTripIdItineraryQueryKey,
  usePostTripsTripIdReplanSessionsSessionIdApply,
} from '@/shared/api/generated/trips/trips';

/**
 * TRIP-441 · AC-3 · BR-U4-28 · INV-U4-05 — 재계획 **확정(apply)** 배선의 얇은 래퍼.
 *
 * codegen `usePostTripsTripIdReplanSessionsSessionIdApply` 를 감싼다. `useStartReplan`(세션 열기)
 * 과 달리 **성공 시 itinerary 쿼리를 무효화**한다 — 확정은 원 일정을 실제로 바꾸는 유일 지점
 * (INV-U4-05)이라, 무효화하지 않으면 바뀐 일정이 live 화면에 refetch 전까지 안 보인다
 * (`useCreateTrip`·`savedPlaces.ts` 무효화 선례와 같은 이유, `useStartReplan` 의 "무효화 없음"과
 * 반대). 무효화 키는 어느 여행인가에 달렸는데, 그 tripId 는 `.mutate({tripId, sessionId})` 의
 * 변수에 이미 있다 — 그래서 hook 인자로 또 받지 않고 onSuccess 의 `variables` 하나에서 읽어
 * 진실을 한 곳으로 둔다. 키는 codegen `getGetTripsTripIdItineraryQueryKey` 를 그대로 써
 * 손으로 다시 적지 않는다(생성물이 키를 바꿔도 어긋나지 않게).
 *
 * ⚠️ codegen apply 훅은 **이 파일에서만** 직접 부른다(BR-U4-28 봉인 — 페이지는 이 seam 경유).
 * 페이지 통합 테스트가 이 심볼을 목 seam 으로 잠근다.
 */
export function useApplyReplan(): ReturnType<
  typeof usePostTripsTripIdReplanSessionsSessionIdApply
> {
  const queryClient = useQueryClient();

  return usePostTripsTripIdReplanSessionsSessionIdApply({
    mutation: {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: getGetTripsTripIdItineraryQueryKey(variables.tripId),
        });
      },
    },
  });
}
