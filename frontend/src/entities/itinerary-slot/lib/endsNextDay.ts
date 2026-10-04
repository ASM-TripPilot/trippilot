/**
 * TRIP-927 · 자정 넘김(`endsNextDay`, HC4) 유도 — 리포에 한 벌뿐이다(`TimeSheet.source.test.ts` AC-5).
 *
 * 종료가 시작과 같거나 이르면 익일로 본다(같은 시각도 익일). 입력은 zero-pad `HH:mm:ss` 라 문자열
 * 사전식 비교가 곧 시각 비교다(초까지 본다). 클라 유도는 제안일 뿐이고 최종 판정은 저장 시 서버다(INV-2).
 */
export function deriveEndsNextDay(startAt: string, endAt: string): boolean {
  return endAt <= startAt;
}

/** 정상 자정 넘김 창 — 늦은 시작(이상)·이른 새벽 종료(미만). 정본 근거 없는 TRIP-1215 01b 선택값이다. */
const NIGHT_START = '18:00:00';
const MORNING_END = '09:00:00';

/**
 * TRIP-1215 · 시각 쌍을 적용해도 되는가(UX 사본 — 최종 판정은 저장 시 서버, INV-2).
 * 같은 날(종료가 시작보다 늦음)이거나, 익일이면 늦은 시작 + 이른 새벽 종료일 때만 허용한다.
 * 같은 시각은 익일로 유도되지만 밤 창 안에 들 수 없어 막힌다. 익일 여부는 위 유도를 부른다(한 벌).
 */
export function isValidTimeRange(startAt: string, endAt: string): boolean {
  return (
    !deriveEndsNextDay(startAt, endAt) ||
    (startAt >= NIGHT_START && endAt < MORNING_END)
  );
}
