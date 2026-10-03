import type { TripDestination } from '../model';

/**
 * TRIP-1208 · h06 카드 커버의 도시 이름 — 첫 목적지(seq 최소)의 region 만 쓴다(여러 도시여도 하나).
 * 비었거나 못 읽으면 null — 호출부가 글자를 그리지 않는다(빈 글자·"undefined" 방지).
 */
export function pickCoverCity(
  destinations: readonly TripDestination[] | undefined
): string | null {
  if (!destinations || destinations.length === 0) return null;
  const first = destinations.reduce((a, b) => (b.seq < a.seq ? b : a));
  const name = first.region?.trim();
  return name ? name : null;
}
