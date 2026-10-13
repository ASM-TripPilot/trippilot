import { useEffect, useState } from 'react';

/**
 * 시각(`deadlineMs`, epoch ms)이 지나면 true. `null` 이면 재지 않고 false.
 * 이미 지난 시각이면 첫 effect 에서 바로 true. 요청을 끊지는 않는다 — 소비처가 true 를 보고 정리한다.
 *
 * shared 에 두는 이유는 `useElapsedFlag` 와 같다(pages·features/itinerary 는 구조 가드가 타이머를 금한다).
 * `useElapsedFlag` 는 "켜진 뒤 ms" 라 서버가 준 기준 시각(세션 생성 시각)에서 재야 하는 상한엔 맞지 않아 따로 둔다.
 */
export function useDeadlineFlag(deadlineMs: number | null): boolean {
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    if (deadlineMs === null) {
      setPassed(false);
      return undefined;
    }
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      setPassed(true);
      return undefined;
    }
    setPassed(false);
    const timer = setTimeout(() => setPassed(true), remaining);
    return () => clearTimeout(timer);
  }, [deadlineMs]);

  return deadlineMs !== null && passed;
}
