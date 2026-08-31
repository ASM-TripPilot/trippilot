import { useGetTripsTripIdVisitsDaysDay } from '@/shared/api/generated/trips/trips';

/**
 * TRIP-565 — 그 날의 방문 기록 조회 훅(얇은 래퍼, 로직 0줄 — 선례 `useLiveItinerary.ts`).
 *
 * `GET /trips/{tripId}/visits/days/{day}` 를 그대로 감싼다. 조립(카드 VM·일자 탭·핀)은
 * `pages/trip-records` 가, 낙관 갱신은 `useVisitCheck` 가 맡는다. day 가 비면(아직 일정 미도착)
 * 쿼리를 끈다.
 */
export function useTripRecords(tripId: string, day: string) {
  return useGetTripsTripIdVisitsDaysDay(tripId, day, {
    query: { enabled: tripId !== '' && day !== '' },
  });
}
