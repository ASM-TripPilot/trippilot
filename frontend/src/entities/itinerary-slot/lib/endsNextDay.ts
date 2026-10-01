/**
 * TRIP-927 · 자정 넘김(`endsNextDay`, HC4) 유도 — 리포에 한 벌뿐이다(`TimeSheet.h04.source.test.ts` AC-5).
 *
 * 종료가 시작과 같거나 이르면 익일로 본다(같은 시각도 익일). 입력은 zero-pad `HH:mm:ss` 라 문자열
 * 사전식 비교가 곧 시각 비교다(초까지 본다). 클라 유도는 제안일 뿐이고 최종 판정은 저장 시 서버다(INV-2).
 */
export function deriveEndsNextDay(startAt: string, endAt: string): boolean {
  return endAt <= startAt;
}
