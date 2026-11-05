import { classifyTripPhase } from '@/entities/trip';

import type { DoneBarEntry } from './doneBar';

/**
 * TRIP-1785 · h06 "내 여행" 「예정 / 지난」 세그(01b D1) — 지난 = 일정 확정 ∧ 오늘 > 종료일(`classifyTripPhase` 가 'ended').
 * 작성중·시작 전·여행 중·일정 상태가 아직 안 온(pending) 여행은 날짜가 지났어도 전부 예정이다. 엔트리를 그대로(같은 참조·입력 순서)
 * 둘로 나눌 뿐이고 정렬은 페이지가 `orderMyTrips` 로 한다.
 */

/** 기기에 이 문자열 그대로 저장된다. */
export type MyTripsSegment = 'upcoming' | 'past';

/** 기기에서 읽은 값 해석 — 정확히 'past' 일 때만 지난, 나머지는 예정(INV-4). */
export function parseMyTripsSegment(raw: unknown): MyTripsSegment {
  return raw === 'past' ? 'past' : 'upcoming';
}

export function splitMyTripsBySegment(
  entries: readonly DoneBarEntry[],
  today: string
): { upcoming: DoneBarEntry[]; past: DoneBarEntry[] } {
  const upcoming: DoneBarEntry[] = [];
  const past: DoneBarEntry[] = [];
  for (const entry of entries) {
    const ended =
      entry.itinerary !== 'pending' &&
      classifyTripPhase(entry.trip, entry.itinerary.status, today) === 'ended';
    (ended ? past : upcoming).push(entry);
  }
  return { upcoming, past };
}
