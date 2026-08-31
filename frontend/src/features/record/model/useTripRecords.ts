import { useGetSavedStays } from '@/shared/api/generated/saved-stays/saved-stays';
import {
  useGetTripsTripIdBases,
  useGetTripsTripIdVisitsDaysDay,
} from '@/shared/api/generated/trips/trips';

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

/**
 * TRIP-569 — 귀속 파생(`stayAttribution`)의 입력이 되는 거점 배정 조회.
 *
 * `features/trip` 에 동명 `useTripBases` 가 있지만 features 간 import 금지(`recordsStructure`
 * G2)라 가져오지 못한다 — 생성 훅 `useGetTripsTripIdBases` 를 record 가 직접 감싼다(맹점1,
 * 위 `useTripRecords` 가 `useGetTripsTripIdVisitsDaysDay` 를 감싸는 것과 같은 패턴, 새 HTTP
 * 없음 G5).
 */
export function useRecordBases(tripId: string) {
  return useGetTripsTripIdBases(tripId, {
    query: { enabled: tripId !== '' },
  });
}

/** TRIP-569 — 숙소명 해소용 저장 숙소 목록 조회(`GET /saved-stays`, 생성 훅 직접 감쌈). */
export function useRecordSavedStays() {
  return useGetSavedStays();
}
