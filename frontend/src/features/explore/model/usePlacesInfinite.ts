import { useInfiniteQuery } from '@tanstack/react-query';

import {
  getPlaces,
  getGetPlacesQueryKey,
} from '@/shared/api/generated/places/places';
import type { GetPlacesParams, Place } from '@/shared/api/generated/schemas';

/**
 * d04·수동추가 '모두 보기' 세로 목록의 커서 무한 스크롤(TRIP-502). 첫 장(서버 limit 분량)만 받고
 * `nextCursor` 로 이어 받는다 — 전량(ACTIVE 11,101건)을 한 번에 받지 않는다.
 *
 * 검색은 **서버**가 한다(`q`). 클라 필터는 "받아온 페이지 안에서만" 검색이라 결과가 조용히 빠지는데
 * (선행 조건, TRIP-502), q 를 queryKey 에 넣어 검색어가 바뀌면 서버를 다시 물어 전체에서 찾는다.
 *
 * queryKey 는 `getGetPlacesQueryKey(params)`(cursor 제외 — 페이지 파라미터는 무한쿼리가 내부로 관리).
 * 이 키가 `['/places', {…}]` 접두사라 d06 상세가 이 캐시를 훑어 단건을 찾는다(TRIP-501). 단, 무한쿼리는
 * `InfiniteData<PlaceList>`(=`{pages, pageParams}`)를 담으므로 상세는 그 모양도 읽도록 적응돼 있다.
 */
export function usePlacesInfinite(params: GetPlacesParams) {
  const query = useInfiniteQuery({
    queryKey: getGetPlacesQueryKey(params),
    queryFn: ({ pageParam, signal }) =>
      getPlaces(
        { ...params, ...(pageParam ? { cursor: pageParam } : {}) },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // 도착한 모든 장을 하나의 목록으로 평탄화 — 화면은 이 배열만 그린다.
  const items: Place[] = (query.data?.pages ?? []).flatMap(
    (page) => page.items
  );

  return { ...query, items };
}
