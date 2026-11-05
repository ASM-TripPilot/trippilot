import { sidoKey } from '@/features/trip/index.view';
import type { Trip, TripRecordList } from '@/shared/api/index.schemas';

/**
 * TRIP-1790 · 마이 탭 「지금까지」 — 종료 여행의 누적 통계(여행·도시·방문) 순수 함수.
 *
 * `ended` 는 마이 탭 「종료」 칸과 같은 판정(`bucketTrips` 의 ended)으로 이미 거른 목록이다 — 여기서 종료를 다시 판정하지 않는다.
 * records(`GET /me/records`)는 종료가 아닌 여행도 함께 주므로 tripId 로 조인해 종료 여행의 방문 수만 더한다.
 * 도시 = 목적지 `regionCode` 앞 2자리(시도)의 고유 수, 코드가 없으면 `sidoKey(region)`(코드 있는 목적지와는 따로 센다 — 한계).
 * 모름(`ended` null · records 미도착)은 null — 0 이 아니다(INV-4).
 */

/** 서버 `/me/records` 의 `limit` 상한. 이만큼 받으면 더 있었을 수 있다(총개수·페이지가 없다). */
export const RECORDS_LIMIT = 100;

export interface CumulativeStats {
  trips: number;
  cities: number;
  visits: number;
  truncated: boolean;
}

export function cumulativeStats(
  ended: readonly Trip[] | null,
  records: TripRecordList | undefined
): CumulativeStats | null {
  if (ended === null || records === undefined) return null;

  const visitsByTrip = new Map(
    records.items.map((item) => [item.tripId, item.visitCount])
  );
  const cities = new Set<string>();
  let visits = 0;
  for (const trip of ended) {
    visits += visitsByTrip.get(trip.tripId) ?? 0;
    for (const dest of trip.destinations) {
      cities.add(
        dest.regionCode ? dest.regionCode.slice(0, 2) : sidoKey(dest.region)
      );
    }
  }
  return {
    trips: ended.length,
    cities: cities.size,
    visits,
    truncated: records.items.length >= RECORDS_LIMIT,
  };
}
