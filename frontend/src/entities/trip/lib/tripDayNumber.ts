// TRIP-1120 · entities/trip/lib/tripDayNumber — 여행 시작일과 오늘('YYYY-MM-DD')로 며칠째인지(1-기반)를
// 센다. j07 진행 중 카드의 'N일차'가 `formatDayLabel` 과 함께 쓴다. 시계를 읽지 않는다(오늘은 인자).

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' → UTC 자정 ms. 문자열 뺄셈이 아니라 달력 산술이라 월말·윤년·해넘김을 넘는다. */
function utcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** 시작 당일 1. */
export function tripDayNumber(startDate: string, today: string): number {
  return Math.round((utcDay(today) - utcDay(startDate)) / MS_PER_DAY) + 1;
}
