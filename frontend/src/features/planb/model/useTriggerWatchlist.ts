import { useActiveTriggers } from './useActiveTriggers';

/**
 * TRIP-562 · useTriggerWatchlist — i09 감시 목록이 쓸 `GET /triggers` 얇은 데이터 훅.
 *
 * tripId 를 `useActiveTriggers`(발화 목록 조회)에 그대로 넘기고 그 react-query 결과를 돌려준다 —
 * 사영·필터는 페이지가 순수 함수 `triggerWatchlist` 로 1회 수행한다(같은 데이터, 다른 사영).
 * `useActiveTriggers` 와 같은 `GET /triggers` 를 감싸지만 소비 표면(감시 3항목)이 달라 이름을 나눈다.
 */
export function useTriggerWatchlist(tripId: string) {
  return useActiveTriggers(tripId);
}
