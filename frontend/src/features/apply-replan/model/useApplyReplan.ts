import { useQueryClient } from '@tanstack/react-query';

import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdTriggersQueryKey,
  usePostTripsTripIdReplanSessionsSessionIdApply,
} from '@/shared/api/index.hooks';
import type { ReplanSession, TriggerList } from '@/shared/api/index.schemas';

/**
 * 서버가 곧 소비할 트리거를 뺀 목록 — 소비 조건 그대로다(BR-SA-14: 같은 id ∧ affectedDate == 세션 targetDate). 날짜가
 * 다르면 서버도 닫지 않으므로 남긴다. 근거 트리거가 없는 세션(수동 재계획)·캐시 없음이면 undefined — 캐시를 건드리지 않는다.
 */
function withoutConsumed(
  list: TriggerList | undefined,
  session: ReplanSession
): TriggerList | undefined {
  if (list === undefined || !session.triggerId) return undefined;
  return {
    ...list,
    triggers: list.triggers.filter(
      (item) =>
        item.triggerId !== session.triggerId ||
        item.affectedDate !== session.targetDate
    ),
  };
}

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
      onSuccess: (session, variables) => {
        queryClient.invalidateQueries({
          queryKey: getGetTripsTripIdItineraryQueryKey(variables.tripId),
        });
        // 적용이 트리거를 소비한다(BR-SA-14, 상황 감지 FE-A) — 다만 서버는 적용 응답 **뒤에** 아웃박스 릴레이(2초 주기)로
        // 닫아서, 지금 다시 받은 목록엔 그 트리거가 아직 있다. 그래서 다시 받되(바뀐 일정에 맞춘 나머지는 서버 그대로),
        // 그 트리거는 받기 전·후 모두 캐시에서 뺀다. 뺀 목록은 새것이라 곧 열릴 허브가 소비 전 목록을 다시 받지 않는다.
        // 'all' — 트리거 진입(푸시·알림함 → i04 → i06)은 적용 순간 목록을 보는 화면이 없다(i04 는 solving 으로 replace).
        const triggersKey = getGetTripsTripIdTriggersQueryKey(variables.tripId);
        const dropConsumed = () =>
          queryClient.setQueryData<TriggerList>(triggersKey, (list) =>
            withoutConsumed(list, session)
          );
        dropConsumed();
        void queryClient
          .invalidateQueries({ queryKey: triggersKey, refetchType: 'all' })
          .then(dropConsumed);
      },
    },
  });
}
