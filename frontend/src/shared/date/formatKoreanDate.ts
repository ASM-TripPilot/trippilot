/**
 * TRIP-395 · "M월 D일 요일" 단일 날짜 포매터 — 여행 중 일정(i01) 헤더 부제 재료.
 *
 * 계약: `formatKoreanDate('2026-08-20')` → `'8월 20일 목요일'`
 *  - 월·일은 leading-zero 제거(`Number('08')` → 8).
 *  - 요일 = 일/월/화/수/목/금/토.
 *
 * TZ-safe: 로컬 타임존에 요일이 밀리지 않게 에포크 일수(UTC 정수)로만 계산한다
 * (`features/trip/model/tripDatePicker.ts` 관례). 이 파일은 execution 밖(shared)이라
 * `liveTimeStructure` 가드 사정거리 밖 — 날짜 산술 자유.
 */

const MS_PER_DAY = 86_400_000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatKoreanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const epochDay = Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
  // 에포크 일수 0(1970-01-01)이 목요일이라 `(에포크일 + 4) % 7`이 일요일 기준 요일이 된다.
  const weekday = WEEKDAYS[((epochDay % 7) + 4) % 7];
  return `${month}월 ${day}일 ${weekday}요일`;
}
