/**
 * TRIP-1557 → TRIP-1739 · 하단 바 치수 — 앱 탭 바(`BottomTabBar`)·허브(i01)·기록 3종(j01·j03·j04) 바가 **같은 값 하나**를 쓴다
 * (Figma `5029:3421` · `5053:3539` 실측). 탭 바(shared)도 읽어야 해서 shared 에 둔다. 별칭(다른 이름의 재수출)을 만들지 않는다.
 */

/** 바 좌우 여백. */
export const NAV_BAR_SIDE = 30;
/** 바 높이(뒤로 지름 겸용). */
export const NAV_BAR_HEIGHT = 58;
/** 바 아래 띄움 — 화면 바닥 기준(하단 안전영역을 더하지 않는다). */
export const NAV_BAR_BOTTOM_GAP = 12;
/** 뒤로 원형과 캡슐 사이 간격(토큰 sm). */
export const NAV_BAR_GAP = 8;
/** 캡슐(탭 바 알약) 안 좌우 패딩. */
export const NAV_BAR_CAPSULE_PADDING_X = 10;
/** 캡슐(탭 바 알약) 안 위아래 패딩. */
export const NAV_BAR_CAPSULE_PADDING_Y = 2;
/** 바가 화면 아래에서 차지하는 높이 = 바 + 바닥 여백. 시트 닫힘 칸·목록 바닥 여백이 이 값을 쓴다. */
export const NAV_BAR_RESERVE = NAV_BAR_HEIGHT + NAV_BAR_BOTTOM_GAP;
/** 허브·기록 바 칸 높이 = 바 − 캡슐 위아래 패딩. 탭 바 칸은 높이를 고정하지 않는다(큰 글자에서 자란다 — TRIP-1642). */
export const NAV_BAR_CELL_HEIGHT =
  NAV_BAR_HEIGHT - NAV_BAR_CAPSULE_PADDING_Y * 2;
/** 칸 아이콘 렌더 크기. */
export const NAV_BAR_ICON_SIZE = 27;
/** 칸 안 아이콘–라벨 간격. */
export const NAV_BAR_CELL_GAP = 3;
