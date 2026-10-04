import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

import {
  deleteTripsTripIdBasesBaseAssignmentId,
  getGetTripsTripIdBasesQueryKey,
  getGetTripsTripIdCoverageQueryKey,
  postTripsTripIdBases,
  useGetTripsTripIdBases,
} from '@/shared/api/index.hooks';
import type {
  AssignBaseRequest,
  BaseAssignment,
} from '@/shared/api/index.schemas';

import { isNotFound } from '@/shared/api';

import { planBaseAssign } from './baseAssignPlan';

/**
 * g02 거점 조회·배정 도메인 훅(TRIP-225). 생성 훅을 도메인 이름으로 감싸는 얇은 층이고
 * (`useCreateTrip`·`useSavedStays` 선례), 이 파일이 지는 판단은 넷이다.
 *
 *  1. **`tripId`가 없으면 요청을 아예 안 보낸다**(01b D7) — 위저드는 `Stack.Protected` 밖이라
 *     딥링크·앱 재시작으로 열린다. 그때 쏘면 전부 404가 되고 화면이 그 404를 "불러올 수
 *     없어요"로 오역한다.
 *  2. **끝나면(성공·실패 모두 — TRIP-1011 C) `bases`·`coverage` 두 키만 무효화한다**(01b D11). 낙관적 갱신을 안 쓰는
 *     이유는 "지정하면 `blocked`가 어떻게 바뀔지"가 서버 판정이기 때문이다(INV-2). 무효화
 *     범위를 인자 없이 넓히면 `saved-stays`까지 다시 도는데, 그 목록은 이 조작으로 안 바뀐다.
 *  3. **409는 실패가 아니다**(01b D13-b) — 목표 상태("이 숙소가 이 여행의 거점이다")와 결과
 *     상태가 같다. 여기서 거부하면 화면이 "지정하지 못했어요"를 띄우는데 실제로는 지정돼 있다.
 *  4. **교체 중 DELETE 의 404도 실패가 아니다**(TRIP-1235) — 지울 배정이 이미 없다는 뜻이다.
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

/**
 * TRIP-1011 C — 지정은 **교체**다. 서버 POST 는 기존 배정을 안 보고 행을 더하므로, 그 밤을 덮던
 * 배정을 지우고(DELETE) 자투리를 다시 붙인 뒤 새 배정을 붙인다(`planBaseAssign`). 호출 모양
 * `mutate({tripId, data})` 는 그대로라 두 페이지(위저드 2/4·여행 단위)가 같은 교체를 쓴다.
 *
 *  - "지금 배정 목록"은 **캐시에서 읽는다** — 여기서 GET 을 새로 쏘면 재조회 횟수가 흔들린다.
 *    캐시가 비었으면 교체 없이 POST 만 나간다. 이 캐시 칸은 마이 탭 여행 카드·기록 탭·MyStaysPage 도
 *    같은 키로 채우므로, h15 처럼 bases 조회를 안 켠 화면에서는 결과가 앞서 들른 화면에 따라 갈린다
 *    (ponytail: 캐시 운 — BE 원자 교체 엔드포인트가 생기면 그쪽으로, 1011 5-b 경고-1).
 *  - DELETE 를 **다 끝낸 뒤** POST 한다 — 섞어 보내면 서버에서 잠깐 겹침이 생긴다.
 *  - 두 요청 이상이라 원자적이지 않다. 그래서 **실패해도** 재조회한다(INV-4 — 중간에 끊기면 서버
 *    상태가 이미 바뀌었을 수 있다).
 */
export function useAssignBase() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateBases();

  return useMutation({
    mutationFn: async (variables: {
      tripId: string;
      data: AssignBaseRequest;
    }) => {
      const current =
        queryClient.getQueryData<BaseAssignment[]>(
          getGetTripsTripIdBasesQueryKey(variables.tripId)
        ) ?? [];
      const plan = planBaseAssign(current, variables.data);

      for (const id of plan.deleteIds) {
        try {
          await deleteTripsTripIdBasesBaseAssignmentId(variables.tripId, id);
        } catch (error) {
          // TRIP-1235 — 404 = 이미 지워졌다(직전 시도가 지우고 붙이기에서 실패, 캐시는 모름). 목표 상태와
          // 같으니 붙이기를 이어 간다. 그 밖의 실패는 그대로 드러낸다(INV-4).
          if (!isNotFound(error)) throw error;
        }
      }
      for (const post of plan.posts) {
        try {
          await postTripsTripIdBases(variables.tripId, post);
        } catch (error) {
          if (!isAlreadyAssigned(error)) throw error;
        }
      }
    },
    onSettled: (_result, _error, variables) => invalidate(variables.tripId),
  });
}
