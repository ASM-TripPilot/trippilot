/**
 * TRIP-576 · l01 알림함 메타 — 과거 시각(occurredAt)을 "방금·N분 전·N시간 전·어제·N일 전"으로.
 * `shared/date/formatKoreanDate`(절대 `M월 D일 요일`)와 다른 기능 — 재사용 불가, 신규.
 * "N분 전"은 **경과 시각**(발생 이후)이라 INV-3 소요시간과 무관하다. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatRelativeTime(iso: string, now: Date): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (diff < MIN) return '방금';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  if (diff < 2 * DAY) return '어제';
  return `${Math.floor(diff / DAY)}일 전`;
}
