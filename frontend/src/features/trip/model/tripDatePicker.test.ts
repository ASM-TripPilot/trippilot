import {
  dateCell,
  daysInMonth,
  firstWeekdayOfMonth,
  isDateInRange,
  shiftMonth,
} from './tripDatePicker';

/**
 * TRIP-368 날짜 선택 순수 함수 — 달력 그리드 계산과 범위 판정(`isDateInRange`).
 *
 * 무엇을 보장하나: 달력 칸 수·요일이 실제 달력과 맞고(에포크 산술이 `new Date`와 같은 답을
 * 내는가), 범위 판정이 양 끝 포함·하한 상한을 옳게 본다.
 *
 * ⚠️ TRIP-389로 시트가 **단일 선택**이 되면서 2단 범위 전이(`applyDatePick`) describe를
 * 걷어냈다 — 그 전이를 부르던 소비자(`TripDateSheet`)가 사라져 dead가 됐다. 그리드 계산·
 * `isDateInRange`는 시트가 여전히 쓰므로 그대로 둔다.
 *
 * 3동작: 준비(입력 날짜) → 실행(함수 호출) → 단언(반환 형태).
 */

describe('tripDatePicker — 달력 그리드 계산', () => {
  it('월 일수를 맞게 센다 (윤년 2월 포함)', () => {
    expect(daysInMonth(2026, 6)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28); // 2026 평년
    expect(daysInMonth(2024, 2)).toBe(29); // 2024 윤년
    expect(daysInMonth(2000, 2)).toBe(29); // 400의 배수 → 윤년
    expect(daysInMonth(1900, 2)).toBe(28); // 100의 배수·400 아님 → 평년
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('에포크 산술로 낸 1일 요일이 실제 달력(new Date)과 일치한다', () => {
    // 테스트 파일은 오라클로 new Date 를 써도 된다(소스 스캔 대상은 화면·순수모듈 파일뿐).
    for (let month = 1; month <= 12; month += 1) {
      const oracle = new Date(2026, month - 1, 1).getDay();
      expect(firstWeekdayOfMonth(2026, month)).toBe(oracle);
    }
  });

  it('월을 옮기고 연 경계를 넘는다', () => {
    expect(shiftMonth('2026-06', 1)).toBe('2026-07');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('dateCell 은 두 자리로 채운 YYYY-MM-DD 를 만든다', () => {
    expect(dateCell('2026-06', 3)).toBe('2026-06-03');
    expect(dateCell('2026-06', 15)).toBe('2026-06-15');
  });
});

describe('tripDatePicker — isDateInRange', () => {
  it('양 끝 포함, 미완성 범위는 항상 false', () => {
    expect(isDateInRange('2026-06-11', '2026-06-10', '2026-06-13')).toBe(true);
    expect(isDateInRange('2026-06-10', '2026-06-10', '2026-06-13')).toBe(true);
    expect(isDateInRange('2026-06-13', '2026-06-10', '2026-06-13')).toBe(true);
    expect(isDateInRange('2026-06-14', '2026-06-10', '2026-06-13')).toBe(false);
    expect(isDateInRange('2026-06-11', '2026-06-10', null)).toBe(false);
  });

  it('하한도 본다 — 시작일보다 앞이면 false (하한 `date >= startDate` 잠금, TRIP-375)', () => {
    // 지금까지 상한(`<= endDate`)만 밟혔다. 하한을 지우면 시작 전 날짜가 in-range 로 새서
    // 달력 하이라이트가 왼쪽으로 번진다. 이 두 줄이 그 뮤테이션에 red 를 낸다.
    expect(isDateInRange('2026-06-09', '2026-06-10', '2026-06-13')).toBe(false);
    expect(isDateInRange('2026-06-01', '2026-06-10', '2026-06-13')).toBe(false);
  });
});
