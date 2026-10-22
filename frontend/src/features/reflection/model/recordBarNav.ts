/**
 * TRIP-1584 · 기록 3종(j01·j03·j04) 하단 바의 칸 이동 규칙 중 순수한 부분.
 */

/** 하단 바(`RecordNavBar`)에 그대로 펼쳐 넣는 칸 이동 콜백 묶음. 없는 칸 콜백 = 그 칸은 눌리지 않는다(회고 = 갈 날짜 없음, 요약 = 서버가 준비 전). */
export interface RecordBarNav {
  onBack: () => void;
  /** 뒤로의 도착지가 탭인가 — 거짓이면 바가 탭 바로 접히는 모프 없이 곧장 간다(TRIP-1600). 렌더 때 스택으로 정한다. */
  exitToTab?: boolean;
  onPressRecords: () => void;
  onPressReflection?: () => void;
  onPressSummary?: () => void;
}

/**
 * 요약(j04) 바의 「회고」 칸이 갈 날짜(Q6) — 여행 중이면 오늘, 끝난 여행이면 마지막 일차, 시작 전이면 없음(칸 비활성).
 * 미래 일차 회고로는 가지 않는다(TRIP-1557 결정 2·3). ISO 날짜('YYYY-MM-DD')는 사전순 = 시간순이라 문자열로 비교한다.
 * `dayDates` 는 여행 일차 날짜를 오름차순으로 — 아직 못 받았으면(빈 배열) 없음이다.
 */
export function pickReflectionDate(
  dayDates: readonly string[],
  today: string
): string | undefined {
  const first = dayDates[0];
  const last = dayDates[dayDates.length - 1];
  if (first === undefined || last === undefined || today < first)
    return undefined;
  return today > last ? last : today;
}
