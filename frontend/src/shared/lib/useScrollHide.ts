import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 세로 스크롤 중이면 `hidden` — FAB 이 본문을 덮지 않게 숨기는 데 쓴다(TRIP-1435 Q-023 결정 1=A, TRIP-1555 공용화).
 * `onScroll` 이 올 때마다 타이머를 새로 걸어 마지막 이벤트로부터 `settleMs` 뒤에 다시 보인다(디바운스).
 * `keepVisible`(담은 곳 메뉴 열림)이면 스크롤 중이어도 숨기지 않는다.
 */
export function useScrollHide(
  keepVisible = false,
  settleMs = 250
): { hidden: boolean; onScroll: () => void } {
  const [scrolling, setScrolling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onScroll = useCallback(() => {
    setScrolling(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setScrolling(false), settleMs);
  }, [settleMs]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return { hidden: scrolling && !keepVisible, onScroll };
}
