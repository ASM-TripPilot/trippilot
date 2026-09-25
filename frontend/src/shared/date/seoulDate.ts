/**
 * TRIP-506 · 순간 → KST 달력 날짜 'YYYY-MM-DD'. 앱의 "오늘"은 서버 `TRAVEL_ZONE`(Asia/Seoul)과
 * 같은 기준이어야 해서 기기 시간대를 쓰지 않는다.
 *
 * KST 는 서머타임이 없어 항상 UTC+9 다 — 9시간을 더한 순간을 UTC 달력으로 읽으면 KST 날짜가 된다.
 * `Intl`·`toLocale*` 은 쓰지 않는다(node·Hermes 결과가 갈림, `budgetAmount`·`formatPrice` 선례).
 * 시계는 읽지 않는다 — 호출부가 `new Date()` 를 넘긴다(시계 금지 소스 가드 우회 방지).
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function seoulDate(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
