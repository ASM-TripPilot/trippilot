/**
 * 여행 기간 직접 선택(TRIP-368) 달력 순수 함수. 프리셋 밖 임의 날짜를 고르는 시트가 쓰는
 * 네 계산(월 일수 · 1일 요일 · 월 이동 · 범위 판정)과 날짜를 고르는 전이(`applyDatePick`)를 담는다.
 * 네트워크·화면을 건드리지 않고, **시계도 안 읽는다** — 오늘 날짜는 시트가 주입받아 넘긴다.
 *
 * 요일·일수 계산은 전부 에포크 일수(UTC 정수)로 한다 — `new Date(...)` 생성자를 안 쓴다.
 * `tripWizardStep1.ts`가 같은 이유(`tripWizardStep1Boundary.test.ts`의 시계 금지)로 에포크 산술을
 * 쓰고, 이 파일도 위저드 화면 전이 그래프에 들어가므로 같은 규율을 따른다.
 *
 * ponytail: `features/stay/model/stayDates.ts`와 달력 수학이 겹친다. features 간 직접 import가
 * 관례상 막혀 복제했다 — 셋째 소비자가 생기면 `shared/`로 승격해 하나로 합치는 게 맞다.
 */

const MS_PER_DAY = 86_400_000;

export interface TripDateRange {
  startDate: string | null;
  endDate: string | null;
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

/** 월 일수. `month`는 1~12(1월=1). */
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

/** `date`가 [start, end] 범위 안(양 끝 포함)인지. 범위가 미완성(한쪽 null)이면 항상 false다 —
 * ISO 날짜 문자열은 사전식 비교가 실제 시간 순서와 일치한다. */
export function isDateInRange(
  date: string,
  startDate: string | null,
  endDate: string | null
): boolean {
  if (startDate === null || endDate === null) return false;
  return date >= startDate && date <= endDate;
}

/**
 * 달력에서 날짜를 하나 골랐을 때의 다음 상태. 결과는 항상 "시작만(대기)" 아니면 "end > start"다 —
 * 역전·같은 날 범위를 **구조적으로** 만들지 않는다(INV-U1-11 종료일 ≥ 시작일을 검사가 아니라 형태로
 * 막는다). 이미 완성된 범위에서 다시 고르면 새로 시작한다.
 */
export function applyDatePick(
  range: TripDateRange,
  picked: string
): TripDateRange {
  if (range.startDate === null || range.endDate !== null) {
    return { startDate: picked, endDate: null };
  }
  if (picked > range.startDate) {
    return { startDate: range.startDate, endDate: picked };
  }
  return { startDate: picked, endDate: null };
}

/** 'YYYY-MM'과 일(day)로 'YYYY-MM-DD' 셀 문자열을 만든다. */
export function dateCell(yearMonth: string, day: number): string {
  return `${yearMonth}-${pad2(day)}`;
}
