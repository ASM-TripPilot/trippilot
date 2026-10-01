/**
 * TRIP-746 · 예정 카드 상태줄 꼬리(" · 11:00–22:00 영업")의 영업시간 표기(Seed 열린 질문 3).
 *
 * 서버 `openingHours` 는 자유형 원문이다. `HH:mm` 두 개가 `-`/`–` 로 이어진 모양만
 * `HH:mm–HH:mm 영업`(en-dash 붙여쓰기)으로 다듬고, 그 밖의 원문은 `<br>` 태그 정리·양끝 공백만
 * 걷는다(TRIP-988, `normalizeOpeningHours`). 원문이 없으면 `null` — 카드가 ` · …` 조각 자체를
 * 생략한다(G6, 빈 칸 금지).
 *
 * TRIP-1021(D11) — 상태줄 꼬리는 한 줄이다. 정리된 원문의 줄마다 줄머리 `- ` 불릿을 걷고 여러 줄은
 * ` · ` 로 잇는다. 범위 규칙은 불릿을 걷은 결과가 한 줄일 때만 쓴다. 여러 줄 표시가 의도인 d06·i05
 * 상세는 `normalizeOpeningHours` 를 직접 쓰므로 여기 규칙이 번지지 않는다.
 */

import { normalizeOpeningHours } from './normalizeOpeningHours';

const HOURS_RANGE = /^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/;
const LINE_BULLET = /^-\s+/;

export function formatOpeningHoursLabel(
  raw: string | null | undefined
): string | null {
  if (raw === null || raw === undefined) return null;
  const lines = normalizeOpeningHours(raw)
    .split('\n')
    .map((line) => line.trim().replace(LINE_BULLET, ''))
    .filter((line) => line !== '');
  // 공백뿐이거나 태그뿐인 원문(`'<br>'`)도 정리하면 줄이 없다 — 빈 조각 대신 생략한다.
  if (lines.length === 0) return null;
  if (lines.length > 1) return lines.join(' · ');
  const text = lines[0] ?? '';
  const match = HOURS_RANGE.exec(text);
  return match ? `${match[1]}–${match[2]} 영업` : text;
}
