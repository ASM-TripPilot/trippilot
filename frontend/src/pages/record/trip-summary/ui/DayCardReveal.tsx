import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useReduceMotion } from '@/shared/lib/reduceMotion';

const REVEAL_DURATION_MS = 450;
const REVEAL_STAGGER_MS = 150;
/** 첫 카드는 경로 그려지기(0.15초 뒤 시작, 0.9초)가 끝난 뒤에 나온다(ms). */
const REVEAL_FIRST_DELAY_MS = 1050;

/**
 * TRIP-1386 · 일차 카드를 경로가 다 그려진 뒤 차례로 올린다(RevealItem 동형 — 형제 page 라 import 못 해 복제).
 * 보이는 값은 안 바꾸고 등장 방식만 입힌다. 동작 줄이기면 등장 없이 곧장 보이고, 답이 오기 전엔 안 보이게 둔다.
 */
export function DayCardReveal({
  index,
  children,
}: {
  index: number;
  children: ReactNode;
}): ReactElement {
  const reduce = useReduceMotion();
  if (reduce === null) return <View className="opacity-0">{children}</View>;
  if (reduce) return <>{children}</>;
  return (
    <Animated.View
      entering={FadeInDown.duration(REVEAL_DURATION_MS).delay(
        REVEAL_FIRST_DELAY_MS + index * REVEAL_STAGGER_MS
      )}
    >
      {children}
    </Animated.View>
  );
}
