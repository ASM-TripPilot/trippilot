// TRIP-808 · entities/trip/lib/formatTripPeriod — 여행 기간 도메인 포맷터 6벌 + 요일 1벌.
// features/trip·itinerary·record 에 흩어져 있던 것을 **바이트 보존 이관**(807 formatPrice 선례).
//
// 여섯 포맷터는 출력이 서로 다르다 — 공백 유무·월 생략 규칙·연도 표기가 갈린다. "비슷하니 하나로"
// 합치면 곧 바이트 회귀라, 각자 옛 출력을 그대로 옮긴다. 옛 자리엔 함수별 재수출 shim 한 줄만 남는다.

const MS_PER_DAY = 86_400_000;

/** 기간 구분자 en dash(U+2013) — 하이픈(-)이 아니다. 눈으로 구분 안 돼 상수로 굳힌다. */
const EN_DASH = '–';

/** 0=일 … 6=토 → 한글 요일 한 글자. `dayOfWeek` 반환 인덱스와 짝이 맞는다. */
export const WEEKDAY_LABELS = [
  '일',
  '월',
  '화',
  '수',
  '목',
  '금',
  '토',
] as const;

/** 기준일 에포크의 요일(0=일 … 6=토). 에포크 0(1970-01-01)=목요일이라 시계 없이 요일을 얻는다. */
export function dayOfWeek(epochDay: number): number {
  return ((epochDay % 7) + 7 + 4) % 7;
}

/** 'YYYY-MM-DD' → 에포크 일수(UTC 기준, 로컬 타임존 무관). */
function toEpochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** 'YYYY-MM-DD' → UTC 자정 ms. 형식이 아니면 NaN(호출부가 빈 결과로 갈라낸다). */
function utcDayTime(date: string): number {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (parts === null) return Number.NaN;
  return Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

/** '6월 10일' — 기간 카드용(0 패딩 없이 숫자만). */
function formatMonthDay(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}월 ${day}일`;
}

/** '6/10' — 구간 행용(0 패딩 제거가 전부). */
function monthDaySlash(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

/** 'YYYY-MM-DD' → [월, 일] 숫자. */
function monthDayNums(date: string): [month: number, day: number] {
  const [, month, day] = date.split('-').map(Number);
  return [month, day];
}

/** '6월 10일 – 6월 13일'(공백 en dash·항상 양쪽 월). 한쪽이라도 없으면 null(빈 문자열 아님 —
 *  "미선택"과 "빈 값"은 다른 뜻). */
export function formatDateRange(
  startDate?: string,
  endDate?: string
): string | null {
  if (startDate === undefined || endDate === undefined) return null;
  return `${formatMonthDay(startDate)} – ${formatMonthDay(endDate)}`;
}

/** '6/10–6/12'(무공백 en dash). */
export function formatSectionRange(dateFrom: string, dateTo: string): string {
  return `${monthDaySlash(dateFrom)}${EN_DASH}${monthDaySlash(dateTo)}`;
}

/** '6월 10일–13일'(무공백·같은 달이면 둘째 월 생략). 달 넘김은 '6월 30일–7월 2일'. */
export function formatTripRange(startDate: string, endDate: string): string {
  const [, startMonth, startDay] = startDate.split('-');
  const [, endMonth, endDay] = endDate.split('-');
  const tail =
    startMonth === endMonth
      ? `${Number(endDay)}일`
      : `${Number(endMonth)}월 ${Number(endDay)}일`;
  return `${Number(startMonth)}월 ${Number(startDay)}일${EN_DASH}${tail}`;
}

/** '6월 10일 – 13일'(공백 en dash·같은 달 생략). 형식오류·역방향은 **빈 문자열**
 *  (formatDateRange 의 null 과 다른 실패값 — 통일 금지). 월·일은 getUTC* 로 읽어 CI 타임존에서도 안 밀린다. */
export function formatConfirmedDateRange(
  startDate: string,
  endDate: string
): string {
  const start = utcDayTime(startDate);
  const end = utcDayTime(endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '';

  const startAt = new Date(start);
  const endAt = new Date(end);
  const startMonth = startAt.getUTCMonth() + 1;
  const endMonth = endAt.getUTCMonth() + 1;
  const head = `${startMonth}월 ${startAt.getUTCDate()}일`;
  const tail =
    startMonth === endMonth
      ? `${endAt.getUTCDate()}일`
      : `${endMonth}월 ${endAt.getUTCDate()}일`;
  return `${head} – ${tail}`;
}

/** '2026.5.1–5.3'(연도·점·무공백). 같은 해면 뒤 연을 접고, 다른 해면 양쪽 다 표기한다.
 *  한쪽이라도 null 이면 못 만들어 null(가짜 날짜 금지). */
export function formatTripDateRange(
  start: string | null,
  end: string | null
): string | null {
  if (start === null || end === null) return null;
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const head = `${sy}.${sm}.${sd}`;
  if (sy !== ey) return `${head}${EN_DASH}${ey}.${em}.${ed}`;
  return `${head}${EN_DASH}${em}.${ed}`;
}

/** '6월 10일(수) – 13일(토)'(요일 삽입·공백 en dash·같은 달 생략). 요일은 dayOfWeek(에포크 산술)로
 *  구해 시계를 안 읽는다. summaryPeriod 가 여기에 ' · N박 M일'을 이어 붙인다. */
export function formatDateRangeWithDow(
  startDate: string,
  endDate: string
): string {
  const [startMonth, startDay] = monthDayNums(startDate);
  const [endMonth, endDay] = monthDayNums(endDate);
  const startDow = WEEKDAY_LABELS[dayOfWeek(toEpochDay(startDate))];
  const endDow = WEEKDAY_LABELS[dayOfWeek(toEpochDay(endDate))];

  const head = `${startMonth}월 ${startDay}일(${startDow})`;
  const tail =
    startMonth === endMonth
      ? `${endDay}일(${endDow})`
      : `${endMonth}월 ${endDay}일(${endDow})`;
  return `${head} ${EN_DASH} ${tail}`;
}
