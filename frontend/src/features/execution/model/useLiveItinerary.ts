import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

/**
 * TRIP-395 · useLiveItinerary — 여행 중 화면의 활성 일정 조회(frontend-components.md §3).
 *
 * 얇은 래퍼다: GET /trips/{tripId}/itinerary 를 부르는 생성 훅을 그대로 넘긴다. 판정(로딩·오류·
 * 오늘 구간·활성 트리거)은 `resolveLiveState`가, 조립은 `pages/live-itinerary`가 맡는다 — 여기
 * 로직을 얹지 않는다. 시각·순서는 솔버 검증값이라 재계산하지 않는다(INV-2).
 */
export function useLiveItinerary(tripId: string) {
  return useGetTripsTripIdItinerary(tripId);
}
