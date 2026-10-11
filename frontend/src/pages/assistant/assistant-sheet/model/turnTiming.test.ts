import fc from 'fast-check';

import { SLOW_TURN_MS, isSlowTurn, secondsLeft } from './turnTiming';

/** TRIP-1326 · BR-U8-44 · BR-U8-24 — 15초 상한 판정·429 남은 초 계산(순수). */

describe('turnTiming (TRIP-1326)', () => {
  it('15초를 넘기면 느린 턴이다(경계 포함 아님)', () => {
    expect(isSlowTurn(1000, 1000 + SLOW_TURN_MS - 1)).toBe(false);
    expect(isSlowTurn(1000, 1000 + SLOW_TURN_MS)).toBe(true);
    expect(isSlowTurn(null, 99999)).toBe(false);
  });

  it('남은 초는 올림이고 0 아래로 내려가지 않는다', () => {
    expect(secondsLeft(10_000, 5_001)).toBe(5);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e9 }),
        fc.integer({ min: 0, max: 1e9 }),
        (until, now) => {
          const left = secondsLeft(until, now);
          expect(left).toBeGreaterThanOrEqual(0);
          expect(left * 1000).toBeGreaterThanOrEqual(until - now);
        }
      )
    );
  });
});
