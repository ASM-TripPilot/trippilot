/**
 * 숙소 등록 날짜 계산 순수 함수(01b Seed §3-4 · AC-4 · AC-5). 달력 그리드에 필요한 네 계산
 * (1일 요일 · 월 일수 · 범위 판정 · 박수)과, 날짜를 고르는 전이(`applyDatePick`)가 역전·같은
 * 날 범위를 구조적으로 만들지 않는 성질을 담는다. 네트워크·시계·화면을 건드리지 않는다.
 *
 * 박수 계산은 항상 에포크 일수(UTC 기준 정수)로 변환해 뺀다 — 로컬 타임존에 따라 하루가
 * 밀리는 것을 막는다(`Date.UTC`는 실행 기계의 타임존과 무관하다).
 */

export interface StayDateRange {
  checkIn: string | null;
  checkOut: string | null;
}

const MS_PER_DAY = 86_400_000;

function toEpochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** 월 일수. `month`는 1~12(1월=1). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * 'YYYY-MM'을 `delta`개월 옮긴다. 연 경계를 넘는다(`2026-12` +1 → `2027-01`).
 *
 * 달력이 한 달만 그려 월 경계를 넘는 범위를 못 고르던 결함(5-b W-1) 때문에 생겼다 —
 * 월말에는 체크인 이후 칸이 화면에 하나도 없어 어떤 범위도 완성할 수 없었다.
 * 개월 총합으로 환산해 계산하므로 12월↔1월에서 따로 분기하지 않는다.
 */
export function shiftMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** 그 달 1일의 요일. 0=일 ~ 6=토. */
export function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

/** 박수. 체크아웃이 체크인보다 뒤일 때만 양수, 그 외(같은 날 · 역전 · 한쪽만 있음 · 둘 다
 * 없음)는 전부 null이다. */
export function nightsBetween(
  checkIn: string | null,
  checkOut: string | null
): number | null {
  if (checkIn === null || checkOut === null) return null;
  const nights = toEpochDay(checkOut) - toEpochDay(checkIn);
  return nights > 0 ? nights : null;
}

/** `date`가 [checkIn, checkOut] 범위 안(양 끝 포함)인지. 범위가 미완성(한쪽 null)이면 항상
 * false다 — ISO 날짜 문자열은 사전식 비교가 실제 시간 순서와 일치한다. */
export function isDateInRange(
  date: string,
  checkIn: string | null,
  checkOut: string | null
): boolean {
  if (checkIn === null || checkOut === null) return false;
  return date >= checkIn && date <= checkOut;
}

/** 저장 가능 판정. 둘 다 없거나 하나만 있으면 true(BR-U1-26), 둘 다 있으면 박수가 나올 때만
 * true(AC-4 역전 차단 · INV-U1-09 같은 날 차단). */
export function isStayRangeValid(
  checkIn: string | null,
  checkOut: string | null
): boolean {
  if (checkIn === null || checkOut === null) return true;
  return nightsBetween(checkIn, checkOut) !== null;
}

/** 달력에서 날짜를 하나 골랐을 때의 다음 상태. 결과는 항상 "대기"(checkOut=null) 아니면
 * "유효 범위"(checkOut > checkIn)다 — 역전·같은 날 범위를 구조적으로 만들지 않는다
 * (§3-4 "필드는 범위 전체 또는 비어 있음 두 상태뿐"의 기계적 근거). */
export function applyDatePick(
  range: StayDateRange,
  picked: string
): StayDateRange {
  // 비어 있거나 이미 완성된 범위 → 새로 시작한다.
  if (range.checkIn === null || range.checkOut !== null) {
    return { checkIn: picked, checkOut: null };
  }
  // 체크아웃 대기 상태 — 앞선 날짜보다 뒤일 때만 범위를 완성한다.
  if (picked > range.checkIn) {
    return { checkIn: range.checkIn, checkOut: picked };
  }
  return { checkIn: picked, checkOut: null };
}

/** 시트를 닫을 때의 확정 처리. 대기 상태(체크인만 있음)는 둘 다 무효로 되돌리고, 완성된
 * 범위는 그대로 둔다 — 화면에 반쪽 상태가 새어 나가지 않는다. */
export function commitDateRange(range: StayDateRange): StayDateRange {
  if (range.checkOut === null) {
    return { checkIn: null, checkOut: null };
  }
  return range;
}
