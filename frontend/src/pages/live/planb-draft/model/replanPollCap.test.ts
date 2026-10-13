import fc from 'fast-check';

import {
  isReplanPollCapped,
  REPLAN_POLL_CAP_MS,
  replanCapDeadlineMs,
} from './replanPollCap';

/** TRIP-1363 · 8분 상한 판정 — 직전엔 정상, 이후엔 상한. 기준 시각은 createdAt, 없으면 마운트 시각. */

const CREATED = '2026-10-13T01:00:00Z';
const CREATED_MS = Date.parse(CREATED);

describe('replanCapDeadlineMs', () => {
  it('상한은 8분이다', () => {
    expect(REPLAN_POLL_CAP_MS).toBe(480_000);
  });

  it('createdAt 이 있으면 그 시각 + 8분이다(마운트 시각은 무시)', () => {
    expect(replanCapDeadlineMs(CREATED, 5)).toBe(CREATED_MS + 480_000);
  });

  it('응답이 없거나(undefined) 읽히지 않으면 마운트 시각 + 8분이다', () => {
    expect(replanCapDeadlineMs(undefined, 1_000)).toBe(481_000);
    expect(replanCapDeadlineMs('not-a-date', 1_000)).toBe(481_000);
  });
});

describe('isReplanPollCapped', () => {
  const deadline = replanCapDeadlineMs(CREATED, 0);

  it('8분 직전(1ms 전)까지는 정상, 정확히 8분부터 상한이다', () => {
    expect(isReplanPollCapped(deadline, CREATED_MS + 479_999)).toBe(false);
    expect(isReplanPollCapped(deadline, CREATED_MS + 480_000)).toBe(true);
  });

  it('PBT — 시각이 기준에서 8분 미만 지났으면 항상 false, 이상이면 항상 true', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        (base, offset) => {
          const d = replanCapDeadlineMs(new Date(base).toISOString(), 0);
          const now = base + offset;
          expect(isReplanPollCapped(d, now)).toBe(offset >= REPLAN_POLL_CAP_MS);
        }
      )
    );
  });

  it('PBT — 시각이 흐를수록 한 번 true 가 되면 계속 true 다(단조)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        fc.nat(10_000_000),
        fc.nat(10_000_000),
        (d, t, dt) => {
          if (isReplanPollCapped(d, t)) {
            expect(isReplanPollCapped(d, t + dt)).toBe(true);
          }
        }
      )
    );
  });
});
