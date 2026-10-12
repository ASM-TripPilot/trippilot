/**
 * 턴 시간 판정(TRIP-1326) — 한 턴 상한 15s(BR-U8-44, DEC-U8-7) · 429 남은 초(BR-U8-24). 순수 함수.
 */

export const SLOW_TURN_MS = 15_000;

/** 보낸 지 15초가 지났나 — 지나면 진행 표시를 유지하고 [대기 취소]를 강조한다. */
export function isSlowTurn(startedAt: number | null, now: number): boolean {
  return startedAt !== null && now - startedAt >= SLOW_TURN_MS;
}

/** 429 로 막힌 남은 초(올림, 0 이상). */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
