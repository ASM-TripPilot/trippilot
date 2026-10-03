import type { TripPhase } from '@/entities/trip';
import type { Trip } from '@/shared/api/index.schemas';

/**
 * TRIP-604 · US-NOTIF-07 · BR-U6-22 — 마이페이지 숫자 3칸(예정·진행 중·종료) 분류 순수 함수.
 *
 * TRIP-1123: 서버 `Trip.status`(날짜만 봄 — 일정 없는 초안도 ACTIVE)가 아니라 여행 단계
 * (`classifyTripPhase` — 일정 확정 × 서울 오늘)로 가른다. 초안은 어느 칸에도 세지 않는다.
 * 단계 하나라도 모르면(일정 조회 대기·404 아닌 실패) 집계 전체가 null — 일부만 센 숫자는 거짓이다(INV-4).
 *
 * 정렬은 여기서 하지 않는다 — 칸 안은 입력 순서를 그대로 보존하고, 정렬은 페이지(`MyPage`)가 진다.
 */

export type TripBucket = 'upcoming' | 'active' | 'ended';

/** 단계 → 칸. 초안은 칸이 없다(null). */
export function phaseBucket(phase: TripPhase): TripBucket | null {
  switch (phase) {
    case 'draft':
      return null;
    case 'upcoming':
      return 'upcoming';
    case 'ongoing':
      return 'active';
    case 'ended':
      return 'ended';
  }
}

/**
 * 목록 분할 — 입력 순서대로 `push` 하므로 칸 안에서 입력 순서가 보존되고, 각 trip 을 그대로(참조 동일)
 * 담는다. `'unknown'` 이 하나라도 있으면 null.
 */
export function bucketTrips(
  entries: readonly { trip: Trip; phase: TripPhase | 'unknown' }[]
): Record<TripBucket, Trip[]> | null {
  const buckets: Record<TripBucket, Trip[]> = {
    upcoming: [],
    active: [],
    ended: [],
  };
  for (const { trip, phase } of entries) {
    if (phase === 'unknown') return null;
    const bucket = phaseBucket(phase);
    if (bucket) buckets[bucket].push(trip);
  }
  return buckets;
}
