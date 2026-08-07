import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  getGetSavedStaysQueryKey,
  patchSavedStaysSavedStayId,
} from '@/shared/api/generated/saved-stays/saved-stays';
import {
  getGetTripsTripIdCoverageQueryKey,
  patchTripsTripId,
} from '@/shared/api/generated/trips/trips';
import type {
  EditSavedStayRequest,
  EditTripRequest,
} from '@/shared/api/generated/schemas';

/**
 * g02 전제 게이트가 쓰는 두 쓰기 훅(TRIP-226 · 01b D1·D4). 생성 훅을 도메인 이름으로 감싸는
 * 얇은 층이고(`useTripBases.ts`·`useSavedStays.ts` 선례), 이 파일이 지는 판단은 **무효화
 * 사정거리 하나뿐**이다.
 *
 *  - **숙소를 고치면 `saved-stays`만** 다시 받아온다. 배정은 이 조작으로 안 바뀌므로
 *    `bases`·`coverage`를 다시 받을 이유가 없다 — 인자 없는 `invalidateQueries()`를 쓰면
 *    멀쩡히 그려진 구간과 커버리지가 통째로 다시 로딩된다.
 *  - **기간을 늘리면 `coverage`만** 다시 받아온다. 날짜가 늘면 커버리지 판정(`blocked`·`days`)이
 *    바뀌는데, 안 받아오면 방금 늘린 날들이 반영되지 않고 `blocked`가 낡은 값으로 남는다 —
 *    화면에 보이는 판정이 서버 검증값이 아니게 되므로 INV-2 위반이다. 배정 목록은 기간을
 *    늘려도 안 바뀐다.
 *
 * 키를 손으로 적지 않고 생성물 헬퍼를 쓰는 이유는 `useTripBases.ts`와 같다 — 다시 적으면
 * 코드젠이 키를 바꿔도 아무도 모르게 어긋난다. 배선이 생성 훅을 직접 물지 않는 이유도 같다:
 * 목킹 가능한 모듈 경로 하나를 만드는 것이 목적이다(`useSavedStays.ts` 머리말).
 */

export function useFixSavedStay() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: {
      savedStayId: string;
      data: EditSavedStayRequest;
    }) => patchSavedStaysSavedStayId(variables.savedStayId, variables.data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: getGetSavedStaysQueryKey() }),
  });
}

export function useExtendTripPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { tripId: string; data: EditTripRequest }) =>
      patchTripsTripId(variables.tripId, variables.data),
    onSuccess: (_result, variables) =>
      queryClient.invalidateQueries({
        queryKey: getGetTripsTripIdCoverageQueryKey(variables.tripId),
      }),
  });
}
