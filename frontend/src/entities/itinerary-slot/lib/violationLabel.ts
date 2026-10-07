/**
 * TRIP-1008 · 위반 표식 문구 두 벌. 새 세 표면(h08 셸·폴백 목록·h14/h16)은 서버 사유를 읽지 않는
 * 고정 라벨 `VIOLATION_NOTICE` 만, 편집기(기존 표면)는 사유를 치환한 `violationLabel` 을 쓴다(02c).
 *
 * 서버 `violationReason` 은 자정 기준 분 정수 범위(`영업시간 밖: 543~618`)를 그대로 싣는다. `~` 로
 * 이어진 정수 쌍만 `HH:mm` 으로 바꾸고 나머지는 글자 그대로 둔다 — 소요시간 문구(`이동 N분 필요`)는
 * `~` 가 없어 손대지 않는다(D5 · INV-3). 분이 1440 이상이면 다음 날 시각이다(1440 나머지).
 */
// 가장 왼쪽·탐욕 매칭이라 숫자 덩어리 중간에서 시작하지 않는다 — 경계 전후방탐색 없이 같다.
const MINUTE_RANGE = /(\d+)~(\d+)/g;

const VIOLATION_FALLBACK = '일정 충돌';

/** 사유가 없거나 숫자가 섞인 옛 형식일 때의 고정 라벨(INV-3 · D5 파싱 금지). */
export const VIOLATION_NOTICE = '일정 확인이 필요해요';

function minuteOfDay(minutes: string): string {
  const m = Number(minutes) % 1440;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function formatViolationMinutes(text: string): string {
  return text.replace(
    MINUTE_RANGE,
    (_, start: string, end: string) =>
      `${minuteOfDay(start)}~${minuteOfDay(end)}`
  );
}

/** 위반이 없으면 `null`(표식 없음). 사유가 없으면 지어내지 않고 `일정 충돌`. */
export function violationLabel(slot: {
  hasViolation: boolean;
  violationReason?: string | null;
}): string | null {
  if (!slot.hasViolation) return null;
  return formatViolationMinutes(slot.violationReason ?? VIOLATION_FALLBACK);
}

/**
 * TRIP-1031 · 새 세 표면의 표식 문구. 서버(TRIP-1030 `ViolationText`)가 type 만 보고 내리는 정성 문구
 * (숫자 없음)는 그대로 보이고, 비었거나 숫자가 하나라도 섞인 옛 형식(`이동 N분 필요`·`543~618`)은
 * 고정 라벨로 막는다(INV-3 방어선). 편집기의 `violationLabel` 은 건드리지 않는다.
 *
 * TRIP-1274 · 슬롯 자기 `distanceRange` 가 비면(교체 뒤 서버가 수리 못 한 구간) 이동 문구 조각만 뺀다 —
 * 거리를 모르는데 "빠듯"을 단정하지 않는다. 위반 코드가 응답에 없어 서버 `ViolationText.phraseOf` 문구와
 * 글자 단위로 맞춘다(서버가 문구를 바꾸면 조용히 다시 보인다).
 */
const TRAVEL_TIME_PHRASE = '앞 장소에서 이동할 시간이 빠듯해요';
const REASON_SEPARATOR = ' · ';

export function violationNotice(slot: {
  hasViolation: boolean;
  violationReason?: string | null;
  distanceRange?: string | null;
}): string | null {
  if (!slot.hasViolation) return null;
  let reason = slot.violationReason?.trim();
  if (reason && !slot.distanceRange) {
    reason = reason
      .split(REASON_SEPARATOR)
      .filter((part) => part !== TRAVEL_TIME_PHRASE)
      .join(REASON_SEPARATOR);
  }
  return reason && !/\d/.test(reason) ? reason : VIOLATION_NOTICE;
}
