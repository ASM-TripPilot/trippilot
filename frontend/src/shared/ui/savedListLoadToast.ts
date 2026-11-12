/**
 * TRIP-1754 · 담은 장소/숙소 목록을 못 받았을 때 하트·배지를 그리는 화면 7곳이 같이 쓰는 토스트 한 벌.
 * 문구·testID 가 갈라지지 않게 상수 하나로 둔다(페이지끼리 import 금지라 shared 에 둔다).
 */
export const SAVED_LIST_LOAD_FAILED_TOAST = {
  message: '저장 목록을 불러오지 못했어요',
  testID: 'saved-list-load-error',
  tone: 'error',
} as const;
