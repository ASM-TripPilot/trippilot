import { useQueryClient } from '@tanstack/react-query';

import {
  getGetTripsQueryKey,
  usePostTrips,
} from '@/shared/api/generated/trips/trips';

/**
 * 생성 훅(`usePostTrips`)을 도메인 이름으로 감싼다(TRIP-203 AC-2, `useStaySearch` 선례와
 * 같은 얇은 층). 호출 모양은 생성물 그대로 `mutateAsync({ data: CreateTripRequest })`다
 * (01b Seed §2 ★17 — 게이트①에서 뒤집을 수 있는 결정이라 여기 그 표기를 그대로 둔다).
 *
 * 보장하는 것은 성공 시 "내 여행 목록"(`GET /trips`) 캐시가 무효화되어 다음에 필요해지면
 * 다시 받아온다는 것뿐이다(01b Seed D5). 여행 상세(`GET /trips/{tripId}`)는 무효화 대상이
 * 아니다 — 방금 만든 여행의 id에 대한 낡은 캐시는 원리적으로 존재할 수 없다. 무효화 키는
 * 생성물의 `getGetTripsQueryKey()`를 그대로 쓴다 — 손으로 다시 적으면 생성물이 키를 바꿔도
 * 아무도 모르게 어긋난다.
 */
export function useCreateTrip() {
  const queryClient = useQueryClient();

  return usePostTrips({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTripsQueryKey() });
      },
    },
  });
}
