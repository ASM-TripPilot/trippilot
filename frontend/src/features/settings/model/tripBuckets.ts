import type { Trip, TripStatus } from '@/shared/api/generated/schemas';

/**
 * TRIP-604 · US-NOTIF-07 · BR-U6-22 — Trip.status 4값을 마이페이지의 3분류로 접는 순수 함수.
 *
 * 서버 status 는 4값(PLANNED·CONFIRMED·ACTIVE·ENDED)이지만 화면 세그먼트는 예정/진행 중/종료
 * 3칸이다. 여기서 status→버킷 사영을 한 곳에 못박아, 화면이 이 분류를 어떻게 그리든(필터든 섹션이든)
 * 분류 자체의 권위가 흩어지지 않게 한다. 화면·서버 없이 값만 검사할 수 있어(순수 함수) PBT 로 잠근다.
 *
 * 정렬(임박순/최근순)은 여기서 하지 않는다 — 버킷 내부는 입력 순서를 그대로 보존하고, 정렬은
 * 컨테이너(`MyPage`)가 진다(관심사 분리, Seed Q4).
 */

export type TripBucket = 'upcoming' | 'active' | 'ended';

/** status→버킷 정본 매핑표(테스트가 같은 표를 진실로 삼는다). PLANNED·CONFIRMED 는 아직 안 떠난
 * '예정', ACTIVE 는 '진행 중', ENDED 는 '종료'. */
const STATUS_BUCKET: Record<TripStatus, TripBucket> = {
  PLANNED: 'upcoming',
  CONFIRMED: 'upcoming',
  ACTIVE: 'active',
  ENDED: 'ended',
};

/** 단건 사영 — 어떤 유효 status 든 세 버킷 중 정확히 하나. */
export function tripStatusBucket(status: TripStatus): TripBucket {
  return STATUS_BUCKET[status];
}

/**
 * 목록 분할 — trips 를 세 버킷으로 나눈다. 입력 순서대로 `push` 하므로 버킷 안에서 입력 순서가
 * 보존되고, 각 trip 을 그대로(참조 동일) 담아 유실·중복·오배치·날조가 원리적으로 없다.
 */
export function bucketTrips(trips: Trip[]): Record<TripBucket, Trip[]> {
  const buckets: Record<TripBucket, Trip[]> = {
    upcoming: [],
    active: [],
    ended: [],
  };
  for (const trip of trips) {
    buckets[tripStatusBucket(trip.status)].push(trip);
  }
  return buckets;
}
