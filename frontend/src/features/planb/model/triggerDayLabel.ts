/**
 * 상황 감지 FE-B · frontend-components §3.4 — 트리거 날짜(`affectedDate`)를 **표시 시점에** 날짜어로 바꾼다.
 *
 * 같은 날 null · 다음 날 `내일` · 그 밖 `M월 D일`(앞자리 0 없음). 서버 문구에는 상대 날짜어가 없다(BR-SA-12 ②) —
 * 저장된 '내일'은 다음 날 틀린 말이 되므로 앱이 그릴 때만 만든다. '모레'는 쓰지 않는다(정본 표에 없다).
 * 'YYYY-MM-DD' 꼴이 아니면 null — 모르는 날짜를 지어내지 않는다. node-safe(달력 산술만, 시계를 읽지 않는다).
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' 의 다음 날 — UTC 달력으로 셈해 기기 시간대·서머타임과 무관하다(월말·연말·윤일은 Date.UTC 가 넘긴다). */
function nextDay(date: string): string | null {
  const match = DATE_RE.exec(date);
  if (match === null) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1))
    .toISOString()
    .slice(0, 10);
}

export function triggerDayLabel(
  affectedDate: string,
  today: string
): string | null {
  const match = DATE_RE.exec(affectedDate);
  if (match === null || affectedDate === today) return null;
  if (affectedDate === nextDay(today)) return '내일';
  return `${Number(match[2])}월 ${Number(match[3])}일`;
}
