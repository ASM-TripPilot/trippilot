// TRIP-759 · entities/trip/lib/formatDayLabel — 1-기반 일차 번호를 한국어 라벨로. j01 방문 기록의
// 일자 탭·귀속 헤더 dayLabel 이 쓴다(옛 'Day1' 영문 탭 대체). 'N일차'는 일차 순번이지 소요시간이 아니다(INV-3).

/** 1-기반 일차 번호 → 'N일차'(예: 1 → '1일차', 10 → '10일차'). */
export function formatDayLabel(day: number): string {
  return `${day}일차`;
}
