import { useQuery } from '@tanstack/react-query';

import { getPlaces } from '@/shared/api/generated/places/places';
import type { PoiCategory } from '@/shared/api/generated/schemas';

import { mergePlacesByPoiId } from './mergePlaces';

/**
 * 다지역 '꼭 갈 곳 더 담기'(2개 이상 지역)의 병렬 조회 훅(TRIP-687).
 *
 * 지역당 단발 `getPlaces`(한 장 최대 `limit`)를 `Promise.all` 로 병렬 조회해
 * `mergePlacesByPoiId` 로 합친다 — 여행 지역 수가 적어(보통 1~3) 지역당 한 장이면 실용상 충분하다.
 * 무한 스크롤은 포기하므로(단일지역 경로가 담당) `fetchNextPage`/`hasNextPage` 는 no-op·false 다.
 *
 * `enabled: regions.length >= 2` — 0/1지역은 `usePlacesInfinite`(무한 스크롤 보존)가 맡고,
 * 이 훅은 화면에서 무조건 호출되되 게이팅으로만 꺼진다(React 훅 규칙 준수). 반환 모양은
 * `usePlacesInfinite` 와 같은 필드 집합이라 `PlaceExplorePage` 가 둘 중 하나를 골라 그대로 소비한다.
 */

// 지역당 한 장의 최대 건수(서버 상한과 동일 — `GetPlacesParams.limit` 은 미지정·초과도 200 으로 맞춘다).
const PER_REGION_LIMIT = 200;

export function useMultiRegionPlaces(
  regions: string[],
  filters: { category?: PoiCategory | null; q?: string } = {}
) {
  const category = filters.category ?? undefined;
  const q = filters.q ?? undefined;

  const query = useQuery({
    queryKey: ['/places/multi', regions, category ?? null, q ?? ''] as const,
    queryFn: async () => {
      // 지역별 조회를 병렬로 하되 한 지역이 실패해도 나머지는 살린다(부분 성공, TRIP-691).
      // Promise.all 은 하나만 실패해도 전체를 reject 해 다른 지역 장소까지 error 로 접었다.
      const results = await Promise.allSettled(
        regions.map((region) =>
          getPlaces({
            region,
            limit: PER_REGION_LIMIT,
            ...(category ? { category } : {}),
            ...(q ? { q } : {}),
          })
        )
      );
      const lists = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value.items] : []
      );
      // 전부 실패면 빈 목록을 성공으로 위장하지 않고 error 를 낸다(INV-4 — 침묵 실패 금지).
      if (lists.length === 0) {
        throw (
          results.find((r) => r.status === 'rejected') as PromiseRejectedResult
        ).reason;
      }
      return mergePlacesByPoiId(lists);
    },
    enabled: regions.length >= 2,
  });

  return {
    items: query.data ?? [],
    isPending: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
    // 다지역은 무한 스크롤 없음 — 소비처(PlaceExplorePage)가 단일지역 경로와 같은 필드를 기대해 자리만 맞춘다.
    fetchNextPage: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
  };
}
