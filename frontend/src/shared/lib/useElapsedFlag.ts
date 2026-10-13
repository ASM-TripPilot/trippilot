import { useEffect, useState } from 'react';

/**
 * `active` 가 `ms` 동안 이어지면 true. `restartKey` 가 바뀌면 0부터 다시 잰다(재시도 = 새 요청 기준).
 * `active` 가 꺼지면 즉시 false. 요청을 끊지는 않는다 — "오래 걸린다"를 알리는 플래그일 뿐이다.
 *
 * shared 에 두는 이유: `pages`·`features/itinerary` 는 구조 가드가 타이머를 금한다(폴링·배너 자동
 * 소거 우회 방지). 이 플래그는 폴링도 소거도 아니라 가드 취지 밖이다(TRIP-1109 h08 조회 지연).
 */
export function useElapsedFlag(
  active: boolean,
  ms: number,
  restartKey?: unknown
): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    setElapsed(false);
    if (!active) return undefined;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms, restartKey]);

  return active && elapsed;
}
