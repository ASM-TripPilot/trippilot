import {
  applyDatePick,
  dateCell,
  daysInMonth,
  firstWeekdayOfMonth,
  isDateInRange,
  shiftMonth,
} from './tripDatePicker';

/**
 * TRIP-368 날짜 선택 순수 함수 — 달력 그리드 계산과 범위 전이(`applyDatePick`).
 *
 * 무엇을 보장하나: (1) 달력 칸 수·요일이 실제 달력과 맞고(에포크 산술이 `new Date`와 같은 답을
 * 내는가), (2) 날짜를 고르는 전이가 **역전·같은 날 범위를 구조적으로 못 만드는가**(INV-U1-11).
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
});

describe('tripDatePicker — applyDatePick 은 역전 범위를 못 만든다 (INV-U1-11)', () => {
  it('빈 상태에서 고르면 시작만 정해진다(대기)', () => {
    expect(
      applyDatePick({ startDate: null, endDate: null }, '2026-06-15')
    ).toEqual({ startDate: '2026-06-15', endDate: null });
  });

  it('시작보다 뒤를 고르면 범위가 완성된다', () => {
    expect(
      applyDatePick({ startDate: '2026-06-15', endDate: null }, '2026-06-17')
    ).toEqual({ startDate: '2026-06-15', endDate: '2026-06-17' });
  });

  it('시작보다 앞을 고르면 역전을 만드는 대신 새 시작으로 다시 시작한다', () => {
    expect(
      applyDatePick({ startDate: '2026-06-15', endDate: null }, '2026-06-12')
    ).toEqual({ startDate: '2026-06-12', endDate: null });
  });

  it('같은 날을 다시 고르면 같은 날 범위를 만들지 않고 다시 시작한다', () => {
    expect(
      applyDatePick({ startDate: '2026-06-15', endDate: null }, '2026-06-15')
    ).toEqual({ startDate: '2026-06-15', endDate: null });
  });

  it('이미 완성된 범위에서 고르면 새로 시작한다', () => {
    expect(
      applyDatePick(
        { startDate: '2026-06-15', endDate: '2026-06-17' },
        '2026-06-20'
      )
    ).toEqual({ startDate: '2026-06-20', endDate: null });
  });
});
