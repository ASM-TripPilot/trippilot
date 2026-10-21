/**
 * TRIP-1522 · 허브 하단 바의 치수 상수와 수정 팝업 위치 계산(순수 — 화면 폭만 받는다).
 *
 * 상수는 Figma A `5029:3421` · B `5031:3438`(사이클 3 정정판) 실측이고, 바 컴포넌트(`LiveBottomBar`)·허브(시트 여백·행사 카드·지도 로고 마진)·
 * 팝업이 **같은 값 하나**를 쓰도록 한 곳에 둔다(따로 베끼면 한쪽만 바뀌어 팝업이 칸에서 어긋난다).
 */

/** 바 좌우 여백 — 앱 하단 탭 바와 같은 30(폭 390 에서 330). 행사 카드도 같은 상수를 쓴다. */
export const LIVE_BAR_SIDE = 30;
/** 바 높이(뒤로 지름 겸용). */
export const LIVE_BAR_HEIGHT = 58;
/** 바 아래 띄움 — 화면 바닥 기준이다(하단 안전영역을 더하지 않는다. 탭 바도 안 더한다). */
export const LIVE_BAR_BOTTOM_GAP = 12;
/** 뒤로 원형과 캡슐 사이 · 팝업 알약 사이 간격(토큰 sm). */
export const LIVE_BAR_GAP = 8;
/** 캡슐 안 좌우 패딩(탭 바와 같은 값). */
export const LIVE_BAR_CAPSULE_PADDING_X = 10;
/** 바 윗변과 그 위에 뜨는 층(수정 팝업·행사 카드) 사이 간격. */
export const LIVE_BAR_FLOAT_GAP = 8;
/**
 * 바가 화면 아래에서 차지하는 높이 = 바 + 바닥 여백. 목록 바닥 여백·팝업/카드 아랫변·지도 로고 마진이
 * 이 한 값을 같이 쓴다(안전영역과 무관).
 */
export const LIVE_BOTTOM_BAR_RESERVE = LIVE_BAR_HEIGHT + LIVE_BAR_BOTTOM_GAP;

export interface EditPopupPlacementInput {
  /** 화면 폭. */
  windowWidth: number;
  /** 팝업 컨테이너 폭(Figma 139). */
  popupWidth: number;
}

/**
 * 수정 팝업을 어디에 붙일까 — 가로 중심 = **수정 칸 중심**(좌우 30 안으로 클램프), 아랫변 = 바 윗변 − 8.
 * 수정 칸은 캡슐의 둘째 칸이다: 중심 x = 16 + 뒤로 58 + 간격 8 + 캡슐 패딩 10 + 칸폭 × 1.5, 칸폭 = (캡슐폭 − 패딩 2×10) / 4,
 * 캡슐폭 = 화면폭 − 좌우 16 − 뒤로 58 − 간격 8. 폭 390 → 197.5(Figma B, 팝업 폭 139 면 left 128).
 * 반환은 절대 배치 값이다(`left` = 왼쪽 끝, `bottom` = 화면 아래로부터 팝업 아랫변까지).
 */
export function editPopupPlacement({
  windowWidth,
  popupWidth,
}: EditPopupPlacementInput): { left: number; bottom: number } {
  const capsuleWidth =
    windowWidth - LIVE_BAR_SIDE * 2 - LIVE_BAR_HEIGHT - LIVE_BAR_GAP;
  const cellWidth = (capsuleWidth - LIVE_BAR_CAPSULE_PADDING_X * 2) / 4;
  const editCenter =
    LIVE_BAR_SIDE +
    LIVE_BAR_HEIGHT +
    LIVE_BAR_GAP +
    LIVE_BAR_CAPSULE_PADDING_X +
    cellWidth * 1.5;
  const maxLeft = windowWidth - LIVE_BAR_SIDE - popupWidth;
  const left = Math.min(
    Math.max(editCenter - popupWidth / 2, LIVE_BAR_SIDE),
    maxLeft
  );
  return {
    left,
    bottom: LIVE_BOTTOM_BAR_RESERVE + LIVE_BAR_FLOAT_GAP,
  };
}
