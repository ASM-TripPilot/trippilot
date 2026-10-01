/**
 * TRIP-988 · 서버 `openingHours` 원문(자유형)에 섞여 오는 `<br>` 계열 태그를 줄바꿈으로 바꾼다.
 *
 * 태그 하나 = 줄바꿈 하나(연속 태그를 접지 않는다). 태그 안 공백 변형(`< br>`·`<br/ >`)도 태그이고,
 * 태그 바로 뒤의 원문 줄바꿈(`\n`·`\r\n`) 하나는 태그와 합친다 — TourAPI 원문이 `<br>\n` 모양으로
 * 오는 경우가 많아 따로 바꾸면 빈 줄이 생긴다. 결과 양끝의 공백·줄바꿈만 걷고 안쪽 원문은 손대지
 * 않는다. 깨진 모양(`<br<`·`<br-`·잘린 `<br…`)은 걸러지지 않는다.
 *
 * 현재 소비처: d06·i05 장소 상세와 한 줄 라벨(`formatOpeningHoursLabel`). `PoiSlotCard` 는 원문을
 * 그대로 그리므로 다시 쓰게 되면 여기를 거치게 해야 한다.
 */

const BR_TAG = /<\s*br\s*\/?\s*>(\r?\n)?/gi;

export function normalizeOpeningHours(raw: string): string {
  return raw.replace(BR_TAG, '\n').trim();
}
