/** ⋯ 아랫변부터 패널 끝까지(간격 3 + 세 줄 151, `TripCard` 팝오버) — 두 줄 메뉴도 이 값으로 잰다. */
const MENU_PANEL_SPACE = 154;

/**
 * TRIP-1819 · ⋯ 메뉴를 아래로 열면 화면 아래를 막는 것에 가리는가 — 가리면 위로 연다.
 * `blockedBottom` 은 화면 바닥에서 비워 둘 높이다. 탭바·완료 배너가 윗변을 신고하고(큰 글자에서 자란 높이 포함)
 * 토스트가 쓰는 그 값을 호출부가 넘긴다.
 */
export function menuOpensAbove(
  buttonBottom: number,
  windowHeight: number,
  blockedBottom: number
): boolean {
  return buttonBottom + MENU_PANEL_SPACE > windowHeight - blockedBottom;
}
