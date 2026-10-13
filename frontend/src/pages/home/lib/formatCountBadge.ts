// 담은 곳 미니 FAB 우상단 개수 배지 문자열(TRIP-695) — 100 이상은 '99+'로 접고 0/음수는 ''.
// 표시 게이트(count≥1일 때만 배지 렌더)는 SavedMenuFab 이 별도로 지고, 여기 0→'' 은 이중 방어다
// (빈 핑크 원 방지). 음수는 발생하지 않지만 방어적으로 '' 로 접는다(01b Q2).
export function formatCountBadge(n: number): string {
  if (n <= 0) return '';
  if (n >= 100) return '99+';
  return String(n);
}
