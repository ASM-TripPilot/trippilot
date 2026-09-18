import fc from 'fast-check';

import {
  applyDatePick,
  commitDateRange,
  daysInMonth,
  firstWeekdayOfMonth,
  isDateInRange,
  isStayRangeValid,
  nightsBetween,
  type StayDateRange,
} from './stayDates';

/**
 * F-1~F-6 (01b Seed §3-4 · AC-4 · AC-5) — 숙소 등록 날짜 계산 순수 함수.
 *
 * 무엇을 보장하나: 달력 그리드를 그리는 데 필요한 네 계산(1일 요일 · 월 일수 · 범위 판정 ·
 * 박수)이 어떤 연·월·날짜 조합에서도 성립하고, 날짜를 고르는 전이(`applyDatePick`)가
 * **역전·같은 날 범위를 구조적으로 만들 수 없다**는 성질까지 잠근다. 그 성질이 Seed §3-4
 * "필드는 '범위 전체' 또는 '비어 있음' 두 상태뿐"의 기계적 근거다.
 *
 * 파일·함수 이름에 `duration`을 쓰지 않는다(INV-3 · 02a ★2) — `staySearchStructure.test.ts`가
 * `features/stay` 전체를 훑어 그 식별자를 0건으로 잠그고 있다. 박수는 `nights`다.
 *
 * 시간대 함정(02a ★12): `new Date('2026-06-10')`은 UTC 자정, `new Date(2026, 5, 10)`은 로컬
 * 자정이라 섞으면 하루가 밀린다. 그래서 이 파일의 기대값은 **에포크 일수(정수) → ISO 문자열**
 * 한 방향으로만 만든다 — 실행 기계의 시간대와 무관하게 결정론적이다.
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

describe('nightsBetween — 박수 (F-3)', () => {
  it('6월 10일 → 6월 12일은 2박이다 (Figma "2박" 실측값)', () => {
    expect(nightsBetween('2026-06-10', '2026-06-12')).toBe(2);
  });

  const NULL_CASES: {
    name: string;
    checkIn: string | null;
    checkOut: string | null;
  }[] = [
    {
      name: '같은 날(INV-U1-09)',
      checkIn: '2026-06-10',
      checkOut: '2026-06-10',
    },
    { name: '역전(AC-4)', checkIn: '2026-06-12', checkOut: '2026-06-10' },
    { name: '체크인만', checkIn: '2026-06-10', checkOut: null },
    { name: '체크아웃만', checkIn: null, checkOut: '2026-06-12' },
    { name: '둘 다 없음', checkIn: null, checkOut: null },
  ];

  it.each(NULL_CASES)('$name → null', ({ checkIn, checkOut }) => {
    expect(nightsBetween(checkIn, checkOut)).toBeNull();
  });

  it('임의 날짜 d와 n박(1~60)에 대해 nightsBetween(d, d+n일) === n', () => {
    fc.assert(
      fc.property(
        epochDayArb,
        fc.integer({ min: 1, max: 60 }),
        (day, nights) => {
          expect(
            nightsBetween(isoFromEpochDay(day), isoFromEpochDay(day + nights))
          ).toBe(nights);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('checkOut이 checkIn 이하이면 임의 입력에서도 항상 null이다', () => {
    fc.assert(
      fc.property(epochDayArb, fc.integer({ min: 0, max: 60 }), (day, back) => {
        expect(
          nightsBetween(isoFromEpochDay(day), isoFromEpochDay(day - back))
        ).toBeNull();
      }),
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

describe('isStayRangeValid — 저장 가능 판정 (F-5 · AC-4 · AC-5)', () => {
  const CASES: {
    name: string;
    checkIn: string | null;
    checkOut: string | null;
    expected: boolean;
  }[] = [
    {
      name: '둘 다 없음 → 저장 가능(AC-5)',
      checkIn: null,
      checkOut: null,
      expected: true,
    },
    {
      name: '체크인만 → 저장 가능(BR-U1-26 "둘 중 하나만 있어도 저장은 된다")',
      checkIn: '2026-06-10',
      checkOut: null,
      expected: true,
    },
    {
      name: '체크아웃만 → 저장 가능',
      checkIn: null,
      checkOut: '2026-06-12',
      expected: true,
    },
    {
      name: '정상 범위 → 저장 가능',
      checkIn: '2026-06-10',
      checkOut: '2026-06-12',
      expected: true,
    },
    {
      name: '역전 → 차단(AC-4)',
      checkIn: '2026-06-12',
      checkOut: '2026-06-10',
      expected: false,
    },
    {
      name: '같은 날 → 차단(INV-U1-09)',
      checkIn: '2026-06-10',
      checkOut: '2026-06-10',
      expected: false,
    },
  ];

  it.each(CASES)('$name', ({ checkIn, checkOut, expected }) => {
    expect(isStayRangeValid(checkIn, checkOut)).toBe(expected);
  });

  it('둘 다 있는 임의 조합에서 유효성과 박수 존재가 정확히 같은 뜻이다', () => {
    fc.assert(
      fc.property(epochDayArb, epochDayArb, (a, b) => {
        const checkIn = isoFromEpochDay(a);
        const checkOut = isoFromEpochDay(b);
        expect(isStayRangeValid(checkIn, checkOut)).toBe(
          nightsBetween(checkIn, checkOut) !== null
        );
      }),
      { numRuns: 500 }
    );
  });

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

describe('applyDatePick · commitDateRange — 날짜 선택 전이 (F-6 · §3-4)', () => {
  const EMPTY: StayDateRange = { checkIn: null, checkOut: null };

  it('빈 상태에서 한 번 탭하면 체크인만 정해진 대기 상태다', () => {
    expect(applyDatePick(EMPTY, '2026-06-10')).toEqual({
      checkIn: '2026-06-10',
      checkOut: null,
    });
  });

  it('대기 상태에서 뒤 날짜를 탭하면 범위가 완성된다', () => {
    expect(
      applyDatePick({ checkIn: '2026-06-10', checkOut: null }, '2026-06-12')
    ).toEqual({ checkIn: '2026-06-10', checkOut: '2026-06-12' });
  });

  it('대기 상태에서 앞 날짜/같은 날을 탭하면 그 날짜로 다시 시작한다 (역전이 생기지 않는다)', () => {
    expect(
      applyDatePick({ checkIn: '2026-06-10', checkOut: null }, '2026-06-08')
    ).toEqual({ checkIn: '2026-06-08', checkOut: null });
    expect(
      applyDatePick({ checkIn: '2026-06-10', checkOut: null }, '2026-06-10')
    ).toEqual({ checkIn: '2026-06-10', checkOut: null });
  });

  it('완성된 범위에서 다시 탭하면 새 범위를 시작한다', () => {
    expect(
      applyDatePick(
        { checkIn: '2026-06-10', checkOut: '2026-06-12' },
        '2026-07-01'
      )
    ).toEqual({ checkIn: '2026-07-01', checkOut: null });
  });

  it('임의의 탭 순서(1~10회)를 거쳐도 결과는 항상 "대기" 아니면 "유효 범위"다', () => {
    // 이 성질이 §3-4 "필드는 범위 전체 또는 비어 있음 두 상태뿐"의 기계적 근거다 —
    // 사용자가 어떤 순서로 눌러도 역전·같은 날 범위가 만들어지지 않는다.
    fc.assert(
      fc.property(
        fc.array(epochDayArb, { minLength: 1, maxLength: 10 }),
        (days) => {
          const range = days
            .map(isoFromEpochDay)
            .reduce<StayDateRange>(applyDatePick, EMPTY);

          expect(range.checkIn).not.toBeNull();
          if (range.checkOut !== null) {
            expect(isStayRangeValid(range.checkIn, range.checkOut)).toBe(true);
          }
          // 완성이든 대기든, 저장 판정은 언제나 통과한다(중간 상태가 저장을 막지 않는다).
          expect(isStayRangeValid(range.checkIn, range.checkOut)).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('닫을 때(commitDateRange) 대기 상태는 둘 다 무효로 되돌리고, 완성된 범위는 그대로 둔다', () => {
    expect(commitDateRange({ checkIn: '2026-06-10', checkOut: null })).toEqual(
      EMPTY
    );
    expect(commitDateRange(EMPTY)).toEqual(EMPTY);
    expect(
      commitDateRange({ checkIn: '2026-06-10', checkOut: '2026-06-12' })
    ).toEqual({ checkIn: '2026-06-10', checkOut: '2026-06-12' });
  });

  it('임의의 탭 순서 뒤 닫으면 결과는 항상 "둘 다 null" 아니면 "유효 범위"다', () => {
    fc.assert(
      fc.property(
        fc.array(epochDayArb, { minLength: 1, maxLength: 10 }),
        (days) => {
          const committed = commitDateRange(
            days
              .map(isoFromEpochDay)
              .reduce<StayDateRange>(applyDatePick, EMPTY)
          );

          const bothNull =
            committed.checkIn === null && committed.checkOut === null;
          const bothSet =
            committed.checkIn !== null && committed.checkOut !== null;
          // 반쪽 상태가 화면으로 새어 나가지 않는다 → 'N박' 표기가 항상 성립한다.
          expect(bothNull || bothSet).toBe(true);
          if (bothSet) {
            expect(
              nightsBetween(committed.checkIn, committed.checkOut)
            ).not.toBeNull();
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});
