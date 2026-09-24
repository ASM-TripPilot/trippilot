/**
 * TRIP-746 · 예정 카드 상태줄 꼬리(" · 11:00–22:00 영업")의 영업시간 표기(Seed 열린 질문 3).
 *
 * 서버 `openingHours` 는 자유형 원문이다. `HH:mm` 두 개가 `-`/`–` 로 이어진 모양만
 * `HH:mm–HH:mm 영업`(en-dash 붙여쓰기)으로 다듬고, 그 밖의 원문은 손대지 않는다. 원문이 없으면
 * `null` — 카드가 ` · …` 조각 자체를 생략한다(G6, 빈 칸 금지).
 */

const HOURS_RANGE = /^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/;

export function formatOpeningHoursLabel(
  raw: string | null | undefined
): string | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const match = HOURS_RANGE.exec(raw.trim());
  return match ? `${match[1]}–${match[2]} 영업` : raw;
}
