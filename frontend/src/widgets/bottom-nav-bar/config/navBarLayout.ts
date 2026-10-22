/**
 * TRIP-1557 · 하단 내비 바 치수 — 허브(i01)·j01 이 **같은 값 하나**를 쓴다(Figma `5029:3421` · `5053:3539` 실측).
 * 허브의 `editPopupLayout` 은 이 값을 `LIVE_BAR_*` 이름으로 재수출한다.
 */

/** 바 좌우 여백 — 앱 하단 탭 바와 같은 30. */
export const NAV_BAR_SIDE = 30;
/** 바 높이(뒤로 지름 겸용). */
export const NAV_BAR_HEIGHT = 58;
/** 바 아래 띄움 — 화면 바닥 기준(하단 안전영역을 더하지 않는다). */
export const NAV_BAR_BOTTOM_GAP = 12;
/** 뒤로 원형과 캡슐 사이 간격(토큰 sm). */
export const NAV_BAR_GAP = 8;
/** 캡슐 안 좌우 패딩(탭 바와 같은 값). */
export const NAV_BAR_CAPSULE_PADDING_X = 10;
/** 바가 화면 아래에서 차지하는 높이 = 바 + 바닥 여백. 시트 닫힘 칸·목록 바닥 여백이 이 값을 쓴다. */
export const NAV_BAR_RESERVE = NAV_BAR_HEIGHT + NAV_BAR_BOTTOM_GAP;
/** 칸 높이 = 바 58 − 캡슐 위아래 패딩 2×2. */
export const NAV_BAR_CELL_HEIGHT = NAV_BAR_HEIGHT - 4;
