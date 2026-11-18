// 새 세션 시작 실패 문구 — 뷰(api-free, 프리뷰가 직접 import)와 `draftNotice`(api 체인)가 같이 읽는 잎 파일이다.
// 뷰가 `draftNotice` 를 import 하면 프리뷰가 네트워크 계층을 전이 로드한다.
export const RETRY_FAILED =
  '다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요';
// 실패 얼굴 [다시 시도]가 지난 날이라 막혔다(409) — 다시 눌러도 같은 거절이라 '잠시 후 다시 시도'라고 하지 않는다. i04 가
// 같은 409 에 보이는 날짜 안내(`NO_ITINERARY_DAY_TEXT`)와 같은 문장이다.
export const RETRY_PAST_DAY =
  '아직 일정이 없는 날이거나 여행 기간이 아니라서 AI가 다시 짤 수 없어요';
