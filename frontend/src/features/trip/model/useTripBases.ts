import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

import {
  deleteTripsTripIdBasesBaseAssignmentId,
  getGetTripsTripIdBasesQueryKey,
  getGetTripsTripIdCoverageQueryKey,
  postTripsTripIdBases,
  useGetTripsTripIdBases,
  useGetTripsTripIdCoverage,
} from '@/shared/api/generated/trips/trips';
import type { AssignBaseRequest } from '@/shared/api/generated/schemas';

/**
 * g02 거점 조회·배정 도메인 훅(TRIP-225). 생성 훅을 도메인 이름으로 감싸는 얇은 층이고
 * (`useCreateTrip`·`useSavedStays` 선례), 이 파일이 지는 판단은 셋뿐이다.
 *
 *  1. **`tripId`가 없으면 요청을 아예 안 보낸다**(01b D7) — 위저드는 `Stack.Protected` 밖이라
 *     딥링크·앱 재시작으로 열린다. 그때 쏘면 전부 404가 되고 화면이 그 404를 "불러올 수
 *     없어요"로 오역한다.
 *  2. **성공하면 `bases`·`coverage` 두 키만 무효화한다**(01b D11). 낙관적 갱신을 안 쓰는
 *     이유는 "지정하면 `blocked`가 어떻게 바뀔지"가 서버 판정이기 때문이다(INV-2). 무효화
 *     범위를 인자 없이 넓히면 `saved-stays`까지 다시 도는데, 그 목록은 이 조작으로 안 바뀐다.
 *  3. **409는 실패가 아니다**(01b D13-b) — 목표 상태("이 숙소가 이 여행의 거점이다")와 결과
 *     상태가 같다. 여기서 거부하면 화면이 "지정하지 못했어요"를 띄우는데 실제로는 지정돼 있다.
 *
 * 무효화가 이 파일에 사는 이유: 재조회는 뮤테이션과 한 몸이라 배선에 두면 판정이 두 층으로
 * 갈린다. 생성 훅 대신 `useMutation` + 생성 **요청 함수**를 쓰는 것은 409를 접으려면
 * `mutationFn`을 갈아야 하는데 생성 훅의 반환 타입이 `BaseAssignment` 고정이라서다
 * (`TripNewStep1Page`가 `postTripsTripIdMustVisits`를 직접 부르는 것과 같은 형태).
 */

/** 이미 그 구간에 배정돼 있다(BR-U1-19 계열 409) — `TripNewStep1Page.isAlreadyRegistered`와
 * 같은 판정이다. */
function isAlreadyAssigned(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 409;
}

export function useTripBases(tripId: string | undefined) {
  return useGetTripsTripIdBases(tripId ?? '', {
    query: { enabled: tripId !== undefined },
  });
}

export function useTripCoverage(tripId: string | undefined) {
  return useGetTripsTripIdCoverage(tripId ?? '', {
    query: { enabled: tripId !== undefined },
  });
}

/** 지정·해제가 공유하는 재조회 사정거리(01b D11). 두 키를 손으로 적지 않고 생성물의 키
 * 헬퍼를 쓴다 — 다시 적으면 생성물이 키를 바꿔도 아무도 모르게 어긋난다. */
function useInvalidateBases(): (tripId: string) => Promise<void> {
  const queryClient = useQueryClient();

  return async (tripId) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getGetTripsTripIdBasesQueryKey(tripId),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetTripsTripIdCoverageQueryKey(tripId),
      }),
    ]);
  };
}

export function useAssignBase() {
  const invalidate = useInvalidateBases();

  return useMutation({
    mutationFn: async (variables: {
      tripId: string;
      data: AssignBaseRequest;
    }) => {
      try {
        await postTripsTripIdBases(variables.tripId, variables.data);
      } catch (error) {
        if (!isAlreadyAssigned(error)) throw error;
      }
    },
    onSuccess: (_result, variables) => invalidate(variables.tripId),
  });
}

export function useUnassignBase() {
  const invalidate = useInvalidateBases();

  return useMutation({
    mutationFn: (variables: { tripId: string; baseAssignmentId: string }) =>
      deleteTripsTripIdBasesBaseAssignmentId(
        variables.tripId,
        variables.baseAssignmentId
      ),
    onSuccess: (_result, variables) => invalidate(variables.tripId),
  });
}
