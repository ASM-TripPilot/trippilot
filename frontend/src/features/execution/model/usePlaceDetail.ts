import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

/**
 * TRIP-398 · usePlaceDetail — i05 현재 장소 상세의 조회. `useLiveItinerary.ts` 선례 복제.
 *
 * 얇은 래퍼다: GET /trips/{tripId}/itinerary 를 부르는 생성 훅을 그대로 넘긴다. poiId 탐색·slack
 * 조립은 `buildPlaceDetailView`가, 배선은 `pages/live-place`가 맡는다 — 여기 로직을 얹지 않는다.
 * 시각·순서는 솔버 검증값이라 재계산하지 않는다(INV-2).
 */
export function usePlaceDetail(tripId: string) {
  return useGetTripsTripIdItinerary(tripId);
}
