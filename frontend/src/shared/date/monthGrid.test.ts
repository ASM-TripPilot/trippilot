import {
  buildMonthGrid,
  daysInMonth,
  firstWeekdayOfMonth,
  isDateInRange,
  shiftMonth,
} from './monthGrid';

/**
 * TRIP-575 · shared/date/monthGrid — 월 캘린더 순수 계산(★정비①).
 *
 * *(개념)* j07 기록 캘린더가 커스텀 월 그리드를 그리는 데 필요한 수학이다. `features/stay`·
 * `features/trip`에 두 벌 있으나 `features/record`가 경계(recordsStructure G2)로 직접 import
 * 못 해서, `actualDistance→shared/geo`·`formatKoreanDate→shared/date` 승격 선례대로 여기 신설한다.
 * 네트워크·화면·시계를 안 건드리는 순수 함수라 입력→출력만 잰다.
 *
 * 3동작 뼈대: 준비=날짜/월 인자 → 실행=함수 호출 → 단언=정확 값(`.toBe`/`.toEqual`).
 */

describe('daysInMonth — 그 달의 일수(month=1~12, 윤년 반영)', () => {
  it('일반 달과 2월(윤년/비윤년)을 정확히 센다', () => {
    // 준비→실행→단언을 한 줄씩. 2028은 윤년(29일), 2027은 비윤년(28일).
    expect(daysInMonth(2026, 6)).toBe(30);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(31);
  });
});

describe('firstWeekdayOfMonth — 그 달 1일의 요일(0=일 ~ 6=토)', () => {
  it('검증 가능한 앵커 날짜의 요일을 맞춘다', () => {
    // 1970-01-01=목(4), 2000-01-01=토(6), 2026-06-01=월(1) — 손으로 확인 가능한 값만 쓴다.
    expect(firstWeekdayOfMonth(1970, 1)).toBe(4);
    expect(firstWeekdayOfMonth(2000, 1)).toBe(6);
    expect(firstWeekdayOfMonth(2026, 6)).toBe(1);
  });
});

describe('shiftMonth — 개월 이동(연 경계를 넘는다)', () => {
  it('12월↔1월 경계와 항등·다중 이동을 처리한다', () => {
    // 'YYYY-MM' 문자열을 delta 개월 옮긴다. 개월 총합 환산이라 12↔1 분기가 없다.
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 3)).toBe('2027-02');
    expect(shiftMonth('2026-06', 0)).toBe('2026-06');
  });
});

describe('isDateInRange — 날이 여행 기간 안(양 끝 포함)인가', () => {
  it('경계 포함·범위 밖·미완성(null)·역전을 구분한다', () => {
    const start = '2026-06-10';
    const end = '2026-06-12';
    // 안쪽·양 끝은 true.
    expect(isDateInRange('2026-06-11', start, end)).toBe(true);
    expect(isDateInRange(start, start, end)).toBe(true);
    expect(isDateInRange(end, start, end)).toBe(true);
    // 범위 밖은 false.
    expect(isDateInRange('2026-06-13', start, end)).toBe(false);
    // 한쪽이라도 null이면 판정 불가 → false(반쪽 상태가 새지 않는다).
    expect(isDateInRange('2026-06-11', null, end)).toBe(false);
    expect(isDateInRange('2026-06-11', start, null)).toBe(false);
    // 역전(start>end)이면 그 사이처럼 보이는 날도 false.
    expect(isDateInRange('2026-06-11', end, start)).toBe(false);
  });
});

describe('buildMonthGrid — 6×7 셀 배열(앞뒤 null 패딩, 길이 7의 배수)', () => {
  it('월요일 시작 달은 앞을 1칸 비우고 뒤를 채워 7의 배수로 만든다', () => {
    // 준비: 2026-06은 1일=월(요일 1), 30일.
    const grid = buildMonthGrid('2026-06');

    // 실행/단언: 길이는 항상 주(7) 단위로 딱 떨어진다.
    expect(grid.length % 7).toBe(0);
    // 앞 요일 수(1)만큼 null 패딩 → idx 0은 빈 자리.
    expect(grid[0]).toBeNull();
    // 1일 셀은 요일 인덱스(1) 자리에 온다.
    expect(grid[1]).toEqual({ date: '2026-06-01', day: 1 });
    // 마지막 날(30)은 앞패딩(1) + (30-1) = idx 30.
    expect(grid[30]).toEqual({ date: '2026-06-30', day: 30 });
    // 실제 날 셀은 정확히 30개(패딩 제외).
    expect(grid.filter((cell) => cell !== null)).toHaveLength(30);
  });

  it('일요일 시작 달은 앞 패딩이 없다', () => {
    // 준비: 2026-02는 1일=일(요일 0), 28일 → 정확히 4주(28칸), 패딩 0.
    const grid = buildMonthGrid('2026-02');

    expect(grid).toHaveLength(28);
    expect(grid[0]).toEqual({ date: '2026-02-01', day: 1 });
    expect(grid[27]).toEqual({ date: '2026-02-28', day: 28 });
    expect(grid.filter((cell) => cell === null)).toHaveLength(0);
  });
});
