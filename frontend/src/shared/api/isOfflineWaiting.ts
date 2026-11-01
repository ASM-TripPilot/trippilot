/**
 * TRIP-1638 · "받아 본 데이터가 없고, 요청이 인터넷 때문에 보류된 채 기다리는 중"인 쿼리만 true.
 *
 * 오프라인으로 처음 켜면 요청이 나가지도 않은 채 `status pending + fetchStatus paused` 가 되는데, 화면이 `isPending` 만
 * 보면 로딩으로 읽혀 스켈레톤이 끝나지 않는다. 받아 둔 값이 있으면(빈 목록 `[]` 포함) 그 값을 그대로 보이므로 false 다.
 * `fetchStatus` 가 없는 입력(옛 훅 목)도 false — 구조 타입이라 react-query 를 import 하지 않는다.
 */
export function isOfflineWaiting(query: {
  data: unknown;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
}): boolean {
  return query.data === undefined && query.fetchStatus === 'paused';
}
