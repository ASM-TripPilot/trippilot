/**
 * TRIP-746 · 예정 카드 상태줄 꼬리(" · 11:00–22:00 영업")의 영업시간 표기(Seed 열린 질문 3).
 *
 * 서버 `openingHours` 는 자유형 원문이다. `HH:mm` 두 개가 `-`/`–` 로 이어진 모양만
 * `HH:mm–HH:mm 영업`(en-dash 붙여쓰기)으로 다듬고, 그 밖의 원문은 `<br>` 태그 정리·양끝 공백만
 * 걷는다(TRIP-988, `normalizeOpeningHours`). 원문이 없으면 `null` — 카드가 ` · …` 조각 자체를
 * 생략한다(G6, 빈 칸 금지).
 */

import { normalizeOpeningHours } from './normalizeOpeningHours';

const HOURS_RANGE = /^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/;

export function formatOpeningHoursLabel(
  raw: string | null | undefined
): string | null {
  if (raw === null || raw === undefined) return null;
  const text = normalizeOpeningHours(raw);
  // 공백뿐이거나 태그뿐인 원문(`'<br>'`)도 정리하면 빈 문자열 — 빈 조각 대신 생략한다.
  if (text === '') return null;
  const match = HOURS_RANGE.exec(text);
  return match ? `${match[1]}–${match[2]} 영업` : text;
}
