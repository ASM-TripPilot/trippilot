import type {
  ItineraryGenerationState,
  ItineraryStatus,
  Trip,
} from '@/shared/api/generated/schemas';

import { deriveTripCardFace } from './tripCardFace';

/**
 * TRIP-928 · h05 완료 도킹 배너 대상 고르기(순수). 정본 공백이라 프론트 규칙(01b Q1~Q5):
 * - 완성 = 카드 배지와 같은 판정(`deriveTripCardFace(...).badge==='done'`) — Mapping A 를 고치면 둘 다 따라간다.
 * - 일정이 하나라도 아직 안 왔으면 보류(null) — 먼저 도착한 덜 최근 완성이 배너를 선점하지 않게.
 * - 후보(완성 ∧ seen 밖) 중 `updatedAt ?? createdAt` 가 가장 최근인 1건.
 * - seenNext = (seen ∩ 목록 id) ∪ 지금 완성 전부 — 줄줄이 뜨지 않게 전부 기록하고, 목록 밖 id 는 버려
 *   SecureStore 값 크기(약 2KB 권고)가 여행 수를 넘지 않게 한다.
 */

export interface DoneBarEntry {
  trip: Trip;
  /** 'pending' = 그 여행의 일정 응답이 아직 안 옴. 왔으면 두 축(404·오류면 둘 다 undefined). */
  itinerary:
    | 'pending'
    | { status?: ItineraryStatus; generationState?: ItineraryGenerationState };
}

export interface DoneBarPick {
  target: Trip;
  seenNext: string[];
}

function sortKey(trip: Trip): string {
  return trip.updatedAt ?? trip.createdAt;
}

export function pickDoneBar(
  entries: readonly DoneBarEntry[],
  seen: readonly string[]
): DoneBarPick | null {
  const done: Trip[] = [];
  for (const { trip, itinerary } of entries) {
    if (itinerary === 'pending') return null;
    const face = deriveTripCardFace(
      itinerary.status,
      itinerary.generationState
    );
    if (face.badge === 'done') done.push(trip);
  }

  const candidates = done.filter((trip) => !seen.includes(trip.tripId));
  if (candidates.length === 0) return null;
  const target = candidates.reduce((best, trip) =>
    sortKey(trip) > sortKey(best) ? trip : best
  );

  const listIds = new Set(entries.map((e) => e.trip.tripId));
  const seenNext = [
    ...new Set([
      ...seen.filter((id) => listIds.has(id)),
      ...done.map((trip) => trip.tripId),
    ]),
  ];
  return { target, seenNext };
}
