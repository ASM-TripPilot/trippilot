import type { TripDestination } from '@/shared/api/index.schemas';

/**
 * TRIP-1043 · 같이 짜기 진행 줄 앞에 붙일 "그날 여행지"(N일차, 1부터).
 *
 * 여행지를 seq 순서로 박수(nights)만큼 펼쳐 그날 칸의 지역을 고르고, 박수 합을 넘는 날(귀국일 포함)은
 * seq 가 가장 큰 여행지다 — g02 `nightlyBaseCards`(features/trip, 밤 단위, TRIP-1010 D7)와 같은 규칙을
 * 날 단위로 옮긴 것이다(형제 feature 라 import 불가). 여행지가 없으면 null(화면이 접두를 생략).
 */
export function regionForDay(
  destinations: readonly TripDestination[],
  dayNumber: number
): string | null {
  if (destinations.length === 0) return null;
  const sorted = [...destinations].sort((a, b) => a.seq - b.seq);
  let remaining = dayNumber;
  for (const destination of sorted) {
    if (remaining <= destination.nights) return destination.region;
    remaining -= destination.nights;
  }
  return sorted[sorted.length - 1].region;
}
