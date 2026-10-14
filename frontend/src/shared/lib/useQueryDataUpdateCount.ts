import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * 캐시 속 쿼리 하나의 `dataUpdateCount`(성공 응답을 받은 누적 횟수)를 **구독으로** 읽는다.
 *
 * 왜 렌더 중 `queryClient.getQueryState()` 직접 읽기가 아닌가: 그 값은 React 가 모르는 외부 값이라
 * React Compiler 가 "순수"로 보고 키가 같은 동안 첫 값을 memo 한다 → 폴링 횟수가 굳어 상한 판정이
 * 영영 안 켜진다(TRIP-1364). 구독이면 캐시가 바뀔 때 React 가 값을 다시 읽는다.
 *
 * 값은 숫자(원시값)라 스냅샷 동등 비교가 안정적이고, 같은 값이면 다시 그리지 않는다.
 * 쿼리가 캐시에 없으면 0.
 */
export function useQueryDataUpdateCount(queryKey: QueryKey): number {
  const queryClient = useQueryClient();
  const hash = hashKey(queryKey);

  // 키 배열은 렌더마다 새로 오는 게 보통이라 해시로 구독 정체성을 고정한다.
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    // hash 가 같으면 같은 쿼리다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, hash]
  );
  const getSnapshot = useCallback(
    () => queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, hash]
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
