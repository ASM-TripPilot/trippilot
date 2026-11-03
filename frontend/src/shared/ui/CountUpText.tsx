import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { countUpText, isCountable } from '@/shared/lib/countUp';
import { useReduceMotion } from '@/shared/lib/reduceMotion';

/** 카운트업 시간(ms) — 모션 명세 「여행 요약」 0.9초 ease-out. */
export const COUNT_UP_DURATION_MS = 900;

/**
 * TRIP-1386 · 요약 숫자가 0 에서 목표값까지 올라가는 Text. 표시 문자열(`12`·`38km`)의 숫자 앞부분만 올리고 접미사는
 * 그대로라 형식이 흔들리지 않는다. 0·`—`(측정 못 함) 같은 값은 애니메이션 없이 그대로(가짜 숫자 금지).
 * 동작 줄이기면 처음부터 최종값. 답이 오기 전엔 안 보이게 두어 0 → 최종값으로 번쩍이는 것을 막는다.
 * 목표 문자열이 바뀌지 않는 한 한 번만 재생한다. 끝 값은 항상 입력 문자열 그대로(INV-2).
 * TRIP-1736 — 시계는 reanimated(UI 스레드)가 돌리고, 표시 문자열이 실제로 바뀔 때만 JS 로 넘겨 다시 그린다.
 */
export function CountUpText({
  value,
  className,
}: {
  value: string;
  className?: string;
}): ReactElement {
  const reduce = useReduceMotion();
  const clock = useSharedValue(0);
  const [shown, setShown] = useState(() => countUpText(value, 0));
  const animate = reduce === false && isCountable(value);

  useEffect(() => {
    if (!animate) return;
    clock.value = 0;
    setShown(countUpText(value, 0));
    clock.value = withTiming(1, {
      duration: COUNT_UP_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
    return () => cancelAnimation(clock);
  }, [animate, value, clock]);

  // 첫 계산(prev === null)은 위 effect 가 이미 그린 값이라 거른다 — 같은 문자열로 한 번 더 그리지 않게.
  // 안 돌 때(null)는 setter 를 부르지 않는다(동작 줄이기·셀 수 없는 값).
  useAnimatedReaction(
    () => (animate ? countUpText(value, clock.value) : null),
    (text, prev) => {
      if (text !== null && prev !== null && text !== prev) {
        runOnJS(setShown)(text);
      }
    }
  );

  return (
    <Text
      className={reduce === null ? `${className ?? ''} opacity-0` : className}
    >
      {animate ? shown : value}
    </Text>
  );
}
