import type { Trip } from '@/shared/api/index.schemas';
import { useGetTrips } from '@/shared/api/index.hooks';
import { isOfflineWaiting } from '@/shared/api';

/**
 * TRIP-575 · j07 캘린더 조회 훅(얇은 래퍼, 조회 전용). `useGetTrips`(=`GET /trips`)를 도메인 이름으로
 * 감싸 `trips`(빈 배열 폴백)·`isPending`·`isError`·`isOffline`(TRIP-1638 — 오프라인으로 처음 켜 요청이 보류된 상태)만 노출한다. 이 화면은 쓰기가 없다 — mutation 훅·
 * customInstance·axios 를 안 문다(INV-U5 조회 화면).
 */
export function useRecordsCalendar(): {
  trips: Trip[];
  isPending: boolean;
  isError: boolean;
  isOffline: boolean;
} {
  const query = useGetTrips();
  const { data, isPending, isError } = query;
  return {
    trips: data ?? [],
    isPending,
    isError,
    isOffline: isOfflineWaiting(query),
  };
}
