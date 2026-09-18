import fc from 'fast-check';

import { daysInMonth, shiftMonth } from './stayDates';

/**
 * W-1 수복분 심판 (5-b 지적 → 게이트② 제시 시 추가).
 *
 * **이 파일은 게이트① 승인 집합 밖이다.** 달력이 한 달만 그려 월 경계를 넘는 범위를 고를 수
 * 없던 결함(5-b W-1, 실측: `today='2026-06-28'`이면 7월 칸 0개 · 완성 가능한 범위 0/3)을
 * 수복하며 `shiftMonth`가 새로 생겼고, 승인된 `stayDates.test.ts`는 동결이라 손댈 수 없어
 * 별도 파일로 심판을 붙인다. 게이트②에서 구현과 함께 제시한다.
 *
 * 왜 필요한가: 개월 총합 환산(`year*12 + (month-1) + delta`)은 연 경계와 음수 delta에서
 * 틀리기 쉽다. 특히 `%`가 음수를 음수로 돌려주는 자바스크립트 특성 때문에 과거로 여러 달
 * 이동하면 `2026-00` 같은 값이 나올 수 있다.
 */

describe('shiftMonth — 달력 표시 월 이동', () => {
  const CASES: { from: string; delta: number; expected: string }[] = [
    { from: '2026-06', delta: 1, expected: '2026-07' },
    { from: '2026-06', delta: -1, expected: '2026-05' },
    // 연 경계 — 12월↔1월에서 해가 넘어간다.
    { from: '2026-12', delta: 1, expected: '2027-01' },
    { from: '2027-01', delta: -1, expected: '2026-12' },
    // 여러 달 이동
    { from: '2026-11', delta: 3, expected: '2027-02' },
    { from: '2026-02', delta: -3, expected: '2025-11' },
    { from: '2026-06', delta: 0, expected: '2026-06' },
  ];

  it.each(CASES)(
    '$from 에서 $delta → $expected',
    ({ from, delta, expected }) => {
      expect(shiftMonth(from, delta)).toBe(expected);
    }
  );

  it('결과는 언제나 YYYY-MM 형식이고 월이 1~12를 벗어나지 않는다', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2020, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: -36, max: 36 }),
        (year, month, delta) => {
          const result = shiftMonth(
            `${year}-${String(month).padStart(2, '0')}`,
            delta
          );

          expect(result).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);

          // 실제 달이어야 한다 — 형식만 맞고 없는 달이면 daysInMonth가 이상한 값을 낸다.
          const [ry, rm] = result.split('-').map(Number);
          expect(daysInMonth(ry, rm)).toBeGreaterThanOrEqual(28);
          expect(daysInMonth(ry, rm)).toBeLessThanOrEqual(31);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('앞으로 n달 갔다가 뒤로 n달 오면 제자리다 (왕복)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2020, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: -36, max: 36 }),
        (year, month, delta) => {
          const start = `${year}-${String(month).padStart(2, '0')}`;
          expect(shiftMonth(shiftMonth(start, delta), -delta)).toBe(start);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('한 달씩 12번 나아가면 같은 달의 이듬해다 (한 번에 12칸과 일치)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2020, max: 2098 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month) => {
          const start = `${year}-${String(month).padStart(2, '0')}`;
          let stepped = start;
          for (let i = 0; i < 12; i += 1) stepped = shiftMonth(stepped, 1);

          expect(stepped).toBe(shiftMonth(start, 12));
          expect(stepped).toBe(`${year + 1}-${String(month).padStart(2, '0')}`);
        }
      ),
      { numRuns: 500 }
    );
  });
});
