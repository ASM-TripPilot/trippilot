import { useEffect, useState } from 'react';

/** 검색어가 이 시간 동안 멈춰야 서버 조회 키가 바뀐다(TRIP-1348, PERF-U1-03). */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * `value` 가 `ms` 동안 더 안 바뀌어야 그 값을 돌려준다. 첫 렌더는 지연 없이 초기값이다.
 * 입력칸에는 원래 값을, 서버 조회 키에는 이 값을 쓰면 글자마다 요청이 나가지 않는다(TRIP-1617).
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
