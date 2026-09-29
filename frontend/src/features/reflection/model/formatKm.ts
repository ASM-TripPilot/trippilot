/**
 * TRIP-1086 · formatKm — 회고 이동 거리(km, 서버 double)를 표시 문자열로(1.929… → '1.9km', 12 → '12km').
 *
 * ★ `toFixed(1)` 단독 반올림은 쓰지 않는다 — 0.15(실제 저장값 0.1499…)를 '0.1' 로 내린다.
 * `Math.round(km * 10) / 10` 은 곱셈 결과가 정확히 1.5 로 떨어져 사람이 쓴 10진 기준 half-up 이 되고,
 * `String()` 이 끝 `.0` 을 저절로 뗀다. "측정 못 함 '—'" 판정은 호출부가 먼저 한다(BR-U5-39).
 */
export function formatKm(km: number): string {
  return `${Math.round(km * 10) / 10}km`;
}
