import type { Trip } from '@/shared/api/generated/schemas';
import { isTripOngoing } from '@/entities/trip/lib/tripPhase';

import type { DoneBarEntry } from './doneBar';

/**
 * TRIP-1121 · h06 "내 여행" 순서(01b D3) — [여행 중] 을 맨 위, 나머지를 그 아래. 두 묶음 모두 같은 비교자.
 * 일정이 아직 안 온(pending) 여행은 판정할 수 없으니 고정하지 않는다(INV-4). 입력은 건드리지 않는다 —
 * 페이지가 `list[i] ↔ itineraries[i]` 인덱스로 짝짓는다.
 */

/** 최신순 — 갱신 시각 내림차순(없으면 생성 시각으로 접는다). */
export function byLatest(a: Trip, b: Trip): number {
  return (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt);
}

export function orderMyTrips(
  entries: readonly DoneBarEntry[],
  today: string,
  compare: (a: Trip, b: Trip) => number = byLatest
): Trip[] {
  const ongoing: Trip[] = [];
  const rest: Trip[] = [];
  for (const { trip, itinerary } of entries) {
    const pinned =
      itinerary !== 'pending' && isTripOngoing(trip, itinerary.status, today);
    (pinned ? ongoing : rest).push(trip);
  }
  return [...ongoing.sort(compare), ...rest.sort(compare)];
}
