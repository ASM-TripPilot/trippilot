import { useCallback, useEffect, useReducer, useRef } from 'react';

import { useReduceMotion } from '@/shared/lib/reduceMotion';

import {
  SLIDE_MS,
  deckReducer,
  initDeck,
  isRunning,
  segmentState,
} from './storyDeck';

/**
 * TRIP-1667 · 스토리 덱 훅 — 순수 리듀서(`storyDeck`)에 진짜 시간을 이어 주는 얇은 층.
 * 돌고 있을 때만 `setTimeout(남은 시간)` 을 걸어 `elapse` 를 보낸다. 누르는 순간에는 "그 장이 시작된 뒤 흐른 시간"을 먼저 `elapse` 로
 * 반영하고 나서 멈춘다(타이머가 다 쓰기 전에 눌러도 남은 시간이 정확하다). 효과 정리로 타이머를 지운다(언마운트 뒤 갱신 0).
 */
export function useStoryDeck(total: number, startAt: 'first' | 'last') {
  const reduce = useReduceMotion();
  const [state, dispatch] = useReducer(deckReducer, undefined, () =>
    initDeck(total, startAt)
  );
  const startedAt = useRef(0);
  const running = isRunning(state);

  useEffect(() => {
    dispatch({ type: 'motion', reduce });
  }, [reduce]);

  const { index, remainingMs } = state;
  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    const timer = setTimeout(
      () => dispatch({ type: 'elapse', ms: remainingMs }),
      remainingMs
    );
    return () => clearTimeout(timer);
  }, [running, index, remainingMs]);

  const onPressIn = useCallback(() => {
    if (running) {
      dispatch({ type: 'elapse', ms: Date.now() - startedAt.current });
    }
    dispatch({ type: 'pressIn' });
  }, [running]);
  const onPressOut = useCallback(() => dispatch({ type: 'pressOut' }), []);
  // 긴 누름 뒤 onPress 가 오지 않게 Pressable 에 `onLongPress` 가 있어야 한다 — 하는 일은 없다.
  const onLongPress = useCallback(() => {}, []);
  const onTap = useCallback(
    (side: 'left' | 'right') => dispatch({ type: 'tap', side }),
    []
  );

  return {
    index,
    total: state.total,
    segments: Array.from({ length: state.total }, (_, i) =>
      segmentState(state, i)
    ),
    /** 지금 칸이 어디서(0~1)부터 얼마(ms) 동안 차오르는가 — 길이가 null 이면 멈춰 있다. */
    fill: {
      from: 1 - remainingMs / SLIDE_MS,
      durationMs: running ? remainingMs : null,
    },
    onPressIn,
    onPressOut,
    onLongPress,
    onTap,
  };
}
