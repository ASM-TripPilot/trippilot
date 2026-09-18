import { useGetTripsTripIdRecords } from '@/shared/api/generated/trips/trips';

/**
 * TRIP-570 — j02 비교 데이터 조회 훅(얇은 래퍼, 로직 0줄 — `useTripRecords`·`useLiveItinerary` 선례).
 *
 * `GET /trips/{tripId}/records` 를 그대로 감싼다 → `TripRecord`(days·changes 임베드). 조립
 * (`buildCompareRows`)·귀속·이름 조인은 `pages/records-compare` 가 진다. 변경 이력은 이 응답의
 * `changes[]` 에 임베드돼 내려오므로 별도 `/change-log` 를 안 붙인다(읽기만, BR-U5-29).
 *
 * ⚠️ 동명 혼동 주의: `useTripRecords`(`features/record/model`)는 `GET /visits/days/{day}` 를 감싸는
 * 별개 훅이다. 이쪽은 `/records`(비교 전용).
 */
export function useCompareRecords(tripId: string) {
  return useGetTripsTripIdRecords(tripId, undefined, {
    query: { enabled: tripId !== '' },
  });
}
