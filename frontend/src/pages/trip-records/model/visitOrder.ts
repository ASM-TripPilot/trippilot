/**
 * TRIP-1069 · 결정 2(a) — 방문 카드 표시 순서: 도착 순간 오름차순, 도착 없는 것은 끝.
 *
 * 서버는 도착 내림차순으로 준다. 비교는 순간(epoch)이다 — 문자열 사전식이면 `'…00.500Z' < '…00Z'` 로
 * 소수 자리가 섞일 때 뒤집힌다. `Array.prototype.sort` 는 안정 정렬이라 같은 값은 입력 순서를 지킨다.
 */
export function orderByArrival<T extends { arrivedAt?: string | null }>(
  visits: readonly T[]
): T[] {
  const key = (v: T): number =>
    v.arrivedAt != null ? Date.parse(v.arrivedAt) : Infinity;
  // 둘 다 도착 없음이면 Infinity - Infinity = NaN → `|| 0` 으로 동률(입력 순서 유지).
  return [...visits].sort((a, b) => key(a) - key(b) || 0);
}
