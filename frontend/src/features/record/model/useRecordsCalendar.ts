import type { Trip } from '@/shared/api/generated/schemas';
import { useGetTrips } from '@/shared/api/generated/trips/trips';

/**
 * TRIP-575 · j07 캘린더 조회 훅(얇은 래퍼, 조회 전용). `useGetTrips`(=`GET /trips`)를 도메인 이름으로
 * 감싸 `trips`(빈 배열 폴백)·`isPending`·`isError`만 노출한다. 이 화면은 쓰기가 없다 — mutation 훅·
 * customInstance·axios 를 안 문다(recordsCalendarStructure G5 · INV-U5 조회 화면).
 */
export function useRecordsCalendar(): {
  trips: Trip[];
  isPending: boolean;
  isError: boolean;
} {
  const { data, isPending, isError } = useGetTrips();
  return { trips: data ?? [], isPending, isError };
}
