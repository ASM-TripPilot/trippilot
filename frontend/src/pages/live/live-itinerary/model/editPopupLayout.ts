import {
  NAV_BAR_CAPSULE_PADDING_X,
  NAV_BAR_GAP,
  NAV_BAR_HEIGHT,
  NAV_BAR_RESERVE,
  NAV_BAR_SIDE,
} from '@/shared/ui/navBarLayout';

/**
 * TRIP-1522 · 허브 하단 바 위에 뜨는 층의 간격과 수정 팝업 위치 계산(순수 — 화면 폭만 받는다).
 *
 * 바 치수(Figma A `5029:3421` · B `5031:3438` 실측)는 `shared/ui/navBarLayout` 의 `NAV_BAR_*` 가 정본이고 허브(시트 여백·행사 카드·
 * 지도 로고 마진)와 팝업이 그 값을 직접 읽는다(TRIP-1739 — 허브 별칭 `LIVE_BAR_*` 는 걷었다). 여기엔 허브 고유 값만 둔다.
 */

/** 바 윗변과 그 위에 뜨는 층(수정 팝업·행사 카드) 사이 간격. */
export const LIVE_BAR_FLOAT_GAP = 8;

export interface EditPopupPlacementInput {
  /** 화면 폭. */
  windowWidth: number;
  /** 팝업 컨테이너 폭(Figma 139). */
  popupWidth: number;
}

/**
 * 수정 팝업을 어디에 붙일까 — 가로 중심 = **수정 칸 중심**(좌우 30 안으로 클램프), 아랫변 = 바 윗변 − 8.
 * 수정 칸은 캡슐의 둘째 칸이다: 중심 x = 30 + 뒤로 58 + 간격 8 + 캡슐 패딩 10 + 칸폭 × 1.5, 칸폭 = (캡슐폭 − 패딩 2×10) / 4,
 * 캡슐폭 = 화면폭 − 좌우 30×2 − 뒤로 58 − 간격 8. 폭 390 → 197.5(Figma B, 팝업 폭 139 면 left 128).
 * 반환은 절대 배치 값이다(`left` = 왼쪽 끝, `bottom` = 화면 아래로부터 팝업 아랫변까지).
 */
export function editPopupPlacement({
  windowWidth,
  popupWidth,
}: EditPopupPlacementInput): { left: number; bottom: number } {
  const capsuleWidth =
    windowWidth - NAV_BAR_SIDE * 2 - NAV_BAR_HEIGHT - NAV_BAR_GAP;
  const cellWidth = (capsuleWidth - NAV_BAR_CAPSULE_PADDING_X * 2) / 4;
  const editCenter =
    NAV_BAR_SIDE +
    NAV_BAR_HEIGHT +
    NAV_BAR_GAP +
    NAV_BAR_CAPSULE_PADDING_X +
    cellWidth * 1.5;
  const maxLeft = windowWidth - NAV_BAR_SIDE - popupWidth;
  const left = Math.min(
    Math.max(editCenter - popupWidth / 2, NAV_BAR_SIDE),
    maxLeft
  );
  return {
    left,
    bottom: NAV_BAR_RESERVE + LIVE_BAR_FLOAT_GAP,
  };
}
