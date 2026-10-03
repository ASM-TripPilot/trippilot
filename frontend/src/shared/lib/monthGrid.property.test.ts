import fc from 'fast-check';

import {
  daysInMonth,
  firstWeekdayOfMonth,
  isDateInRange,
  shiftMonth,
} from '@/shared/lib/monthGrid';

/**
 * `shared/lib/monthGrid` 성질 테스트(PBT) — TRIP-1052에서 이관.
 *
 * 이 케이스들은 원래 `features/stay/model/stayDates.test.ts`(F-1 · F-2 · F-4 · ISO 순서)와
 * `features/stay/model/stayCalendarMonth.test.ts`(shiftMonth 전부)에 있었다. 파일 이름은 stay지만
 * 지키는 대상은 공유 달력 수학이고, 여행 달력(`PeriodEditSheet` · `TripNewStep1Page`)이 계속 쓴다.
 * 숙소 등록 달력이 사라지며(TRIP-1052) 두 파일을 지우므로, 본문을 바꾸지 않고 여기로 옮긴다 —
 * 파일째 지우면 전 스위트가 green인 채로 이 성질들만 조용히 사라진다.
 * 예시 기반 단언은 `monthGrid.test.ts`, 성질(임의 입력) 단언은 이 파일이다.
 *
 * 시간대 함정: 기대값은 **에포크 일수(정수) → ISO 문자열** 한 방향(UTC)으로만 만든다 —
 * 실행 기계의 시간대와 무관하게 결정론적이다.
 */

const MS_PER_DAY = 86_400_000;

/** 에포크 일수(1970-01-01 = 0)를 'YYYY-MM-DD'로. UTC 한 경로만 쓴다. */
function isoFromEpochDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 1970-01-01 ~ 2099-12-31 대략 구간의 에포크 일수. */
const epochDayArb = fc.integer({ min: 0, max: 47_500 });

/** 윤년 규칙을 테스트가 독립적으로 다시 적는다 — 구현과 같은 식을 쓰면 항진명제가 된다. */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

describe('daysInMonth — 월 일수 (F-1)', () => {
  const CASES: { year: number; month: number; expected: number }[] = [
    { year: 2026, month: 1, expected: 31 },
    { year: 2026, month: 2, expected: 28 },
    { year: 2024, month: 2, expected: 29 }, // 4로 나뉨
    { year: 2000, month: 2, expected: 29 }, // 400으로 나뉨
    { year: 1900, month: 2, expected: 28 }, // 100으로 나뉘고 400으로 안 나뉨
    { year: 2026, month: 4, expected: 30 },
    { year: 2026, month: 12, expected: 31 },
  ];

  it.each(CASES)('$year-$month → $expected일', ({ year, month, expected }) => {
    expect(daysInMonth(year, month)).toBe(expected);
  });

  it('임의 연도에서 12개월 합이 365/366이고, 366인 해가 윤년 규칙과 정확히 일치한다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1970, max: 2100 }), (year) => {
        const total = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
          .map((month) => daysInMonth(year, month))
          .reduce((sum, days) => sum + days, 0);

        // 합계가 두 값 중 하나다(달마다 28~31 범위인 것보다 훨씬 강한 성질).
        expect([365, 366]).toContain(total);
        // 366인 해와 윤년이 정확히 같은 집합이다.
        expect(total === 366).toBe(isLeapYear(year));
      }),
      { numRuns: 500 }
    );
  });
});

describe('firstWeekdayOfMonth — 1일 요일 (F-2)', () => {
  it('2026-06-01은 월요일(1)이고 2026-01-01은 목요일(4)이다', () => {
    expect(firstWeekdayOfMonth(2026, 6)).toBe(1);
    expect(firstWeekdayOfMonth(2026, 1)).toBe(4);
  });

  it('항상 0~6이고, 다음 달 1일 요일 = (이번 달 1일 요일 + 이번 달 일수) mod 7', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month) => {
          const weekday = firstWeekdayOfMonth(year, month);
          expect(weekday).toBeGreaterThanOrEqual(0);
          expect(weekday).toBeLessThanOrEqual(6);

          // 관계식 — 구현을 다시 계산하지 않고 두 호출을 서로 대조한다(항진명제 회피).
          const nextYear = month === 12 ? year + 1 : year;
          const nextMonth = month === 12 ? 1 : month + 1;
          expect(firstWeekdayOfMonth(nextYear, nextMonth)).toBe(
            (weekday + daysInMonth(year, month)) % 7
          );
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('isDateInRange — 범위 판정 (F-4)', () => {
  it('범위 양 끝은 포함이고 하루 밖은 제외다', () => {
    expect(isDateInRange('2026-06-10', '2026-06-10', '2026-06-12')).toBe(true);
    expect(isDateInRange('2026-06-11', '2026-06-10', '2026-06-12')).toBe(true);
    expect(isDateInRange('2026-06-12', '2026-06-10', '2026-06-12')).toBe(true);
    expect(isDateInRange('2026-06-09', '2026-06-10', '2026-06-12')).toBe(false);
    expect(isDateInRange('2026-06-13', '2026-06-10', '2026-06-12')).toBe(false);
  });

  it('범위가 미완성(한쪽 null)이면 어떤 날짜도 범위 안이 아니다', () => {
    fc.assert(
      fc.property(epochDayArb, epochDayArb, (a, b) => {
        const date = isoFromEpochDay(a);
        const other = isoFromEpochDay(b);
        expect(isDateInRange(date, other, null)).toBe(false);
        expect(isDateInRange(date, null, other)).toBe(false);
        expect(isDateInRange(date, null, null)).toBe(false);
      }),
      { numRuns: 500 }
    );
  });

  it('유효 범위 안에 있는 날짜 수가 정확히 (박수 + 1)이다', () => {
    fc.assert(
      fc.property(
        epochDayArb,
        fc.integer({ min: 1, max: 30 }),
        (day, nights) => {
          const checkIn = isoFromEpochDay(day);
          const checkOut = isoFromEpochDay(day + nights);

          // 범위 앞뒤로 2일씩 넓게 훑어 안에 든 개수를 실제로 센다.
          let inside = 0;
          for (let offset = -2; offset <= nights + 2; offset += 1) {
            if (
              isDateInRange(isoFromEpochDay(day + offset), checkIn, checkOut)
            ) {
              inside += 1;
            }
          }
          expect(inside).toBe(nights + 1);
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('ISO 날짜 문자열 순서 (isDateInRange·과거 비활성 판정의 근거)', () => {
  it('ISO 날짜는 문자열 사전식 비교와 실제 시간 순서가 항상 일치한다 (과거 비활성 판정의 근거)', () => {
    // 달력의 "오늘 이전 회색"(§3-4)을 문자열 비교로 판정해도 되는지를 잠근다.
    fc.assert(
      fc.property(epochDayArb, epochDayArb, (a, b) => {
        expect(isoFromEpochDay(a) < isoFromEpochDay(b)).toBe(a < b);
      }),
      { numRuns: 500 }
    );
  });
});

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
