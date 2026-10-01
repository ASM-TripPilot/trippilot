import fc from 'fast-check';

import { tripDayNumber } from './tripDayNumber';

/**
 * TRIP-1120 · tripDayNumber — 여행 시작일과 오늘('YYYY-MM-DD')로 "며칠째인가"(1-기반)를 센다.
 * j07 진행 중 카드의 `N일차` 가 쓴다. 시작 당일이 1일차다(homePhase 선례).
 *
 * 무엇을 보장하나:
 *  - 달·해가 바뀌어도, 윤년 2월을 지나도 하루씩 정확히 센다(날짜 문자열을 숫자로 빼면 틀린다).
 *  - 시계를 읽지 않는다 — 오늘은 인자로 받는다.
 *
 * 3동작 뼈대: 준비=두 날짜 → 실행=tripDayNumber → 단언=일차 번호.
 */

describe('🔴 TRIP-1120 · tripDayNumber — 시작 당일 1일차', () => {
  it.each([
    ['2026-06-10', '2026-06-10', 1],
    ['2026-06-10', '2026-06-11', 2],
    ['2026-06-10', '2026-06-12', 3],
  ])('시작 %s · 오늘 %s → %i일차', (start, today, day) => {
    expect(tripDayNumber(start, today)).toBe(day);
  });

  it.each([
    ['월말을 넘는다', '2026-01-31', '2026-02-01', 2],
    ['평년 2월 끝', '2026-02-28', '2026-03-01', 2],
    ['윤년 2월 29일을 지난다', '2028-02-28', '2028-03-01', 3],
    ['해를 넘긴다', '2026-12-30', '2027-01-02', 4],
  ])('%s — 시작 %s · 오늘 %s → %i', (_label, start, today, day) => {
    expect(tripDayNumber(start, today)).toBe(day);
  });

  it('PBT — 시작일에서 k일 지난 날은 언제나 k+1일차다(오라클 = Date.UTC 차)', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2099, 0, 1) }),
        fc.integer({ min: 0, max: 400 }),
        (startMs, k) => {
          const start = iso(startMs);
          const today = iso(Date.parse(`${start}T00:00:00Z`) + k * DAY_MS);
          expect(tripDayNumber(start, today)).toBe(k + 1);
        }
      ),
      { numRuns: 300 }
    );
  });
});
