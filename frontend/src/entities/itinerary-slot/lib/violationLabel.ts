/** 사유가 없거나 숫자가 섞인 옛 형식일 때의 고정 라벨(INV-3 · D5 파싱 금지). */
export const VIOLATION_NOTICE = '일정 확인이 필요해요';

/**
 * TRIP-1031 · 위반 표식 문구 — h08 셸·폴백 목록·h14/h16, TRIP-1298 부터 편집기(h12·i07)도 같은 함수를 쓴다. 서버(TRIP-1030 `ViolationText`)가 type 만 보고 내리는 정성 문구
 * (숫자 없음)는 그대로 보이고, 비었거나 숫자가 하나라도 섞인 옛 형식(`이동 N분 필요`·`543~618`)은
 * 고정 라벨로 막는다(INV-3 방어선).
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
