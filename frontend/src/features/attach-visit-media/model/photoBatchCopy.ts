/** TRIP-1797 · 여러 장 붙이기 문구 — j01·허브가 같은 말을 쓴다(순수라 프리뷰도 `index.view` 로 읽는다). */
export const photoProgressLabel = (current: number, total: number): string =>
  `${current}/${total} 붙이는 중`;
export const photoFailedText = (count: number): string =>
  `${count}장을 붙이지 못했어요`;
export const photoSavedText = (count: number): string =>
  `사진 ${count}장을 붙였어요`;
export const PHOTO_SAVED_SINGLE_TEXT = '사진을 기록했어요';
export const PHOTO_LIMIT_FULL_TEXT =
  '이 방문엔 사진을 더 붙일 수 없어요 (최대 30장)';
