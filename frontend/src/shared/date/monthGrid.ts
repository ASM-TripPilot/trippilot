/**
 * TRIP-575 · 월 캘린더 순수 계산(도메인 무지). j07 기록 캘린더가 커스텀 월 그리드를 그리는 데
 * 쓰는 네 계산(월 일수 · 1일 요일 · 월 이동 · 범위 판정)과 주 단위(7의 배수) 셀 배열 조립을 담는다.
 *
 * 이 수학은 `features/stay/model/stayDates.ts`·`features/trip/model/tripDatePicker.ts`에 **두 벌**
 * 있으나, `features/record`가 그 둘을 직접 import 하면 경계(recordsStructure G2) 위반이다.
 * `actualDistance→shared/geo`·`formatKoreanDate→shared/date` 승격 선례대로 여기 신설해 record 가
 * 쓴다(record 내 재구현 금지 · stay/trip 두 벌의 shared 통합은 후속 Follow-up G).
 *
 * TZ-safe: 로컬 타임존에 요일·경계가 밀리지 않게 에포크 일수(UTC 정수)로만 계산한다
 * (`formatKoreanDate`·`tripDatePicker` 관례) — `new Date(...)` 생성자를 안 쓴다.
 */

const MS_PER_DAY = 86_400_000;

export interface MonthCell {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 1~31 */
  day: number;
}

function toEpochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** 그 달의 일수. `month`는 1~12(1월=1). 윤년 반영. */
export function daysInMonth(year: number, month: number): number {
  return [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
}

/**
 * 그 달 1일의 요일. 0=일 ~ 6=토. 에포크 일수 0(1970-01-01)이 목요일(4)이라, `(에포크일 + 4) % 7`이
 * 일요일 기준 요일이 된다.
 */
export function firstWeekdayOfMonth(year: number, month: number): number {
  const first = toEpochDay(`${year}-${pad2(month)}-01`);
  return ((first % 7) + 4) % 7;
}

/** 'YYYY-MM'을 `delta`개월 옮긴다. 연 경계를 넘는다(개월 총합 환산이라 12월↔1월 분기가 없다). */
export function shiftMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}

/**
 * `date`가 [start, end] 범위 안(양 끝 포함)인지. 범위가 미완성(한쪽 null)이면 항상 false —
 * "반쪽 상태"가 마킹으로 새지 않게 접는다. ISO 날짜 문자열은 사전식 비교가 실제 시간 순서와 일치한다.
 */
export function isDateInRange(
  date: string,
  start: string | null,
  end: string | null
): boolean {
  if (start === null || end === null) return false;
  return date >= start && date <= end;
}

/**
 * 'YYYY-MM'의 달력 셀 배열(길이는 항상 7의 배수 — 달·시작 요일에 따라 4·5·6주로 가변, 예:
 * 일요일 시작 2월은 28칸). 앞은 1일 요일 수만큼 null 패딩, 뒤는 길이가 7의 배수가 되게 null
 * 패딩한다(주 단위로 딱 떨어지는 그리드). 비-null 셀은 1일부터 말일까지 오름차순·유일.
 */
export function buildMonthGrid(yearMonth: string): (MonthCell | null)[] {
  const [year, month] = yearMonth.split('-').map(Number);
  const lead = firstWeekdayOfMonth(year, month);
  const total = daysInMonth(year, month);

  const cells: (MonthCell | null)[] = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let day = 1; day <= total; day += 1) {
    cells.push({ date: `${yearMonth}-${pad2(day)}`, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
