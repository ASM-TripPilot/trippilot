import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useReduceMotion } from '@/shared/lib/reduceMotion';

/** 카드 하나가 아래에서 올라오며 나타나는 시간(ms) — 모션 명세 「완성 일정 공개」. */
const REVEAL_DURATION_MS = 450;
/** 카드 사이 간격(ms). */
const REVEAL_STAGGER_MS = 150;
/** 첫 카드는 경로가 그려지기 시작한 뒤에 나온다(ms). */
const REVEAL_FIRST_DELAY_MS = 500;

/**
 * TRIP-1385 · 완성 일정(h14) 첫 공개 때 카드를 위에서부터 차례로 올린다. 보이는 값은 안 바꾸고 등장 방식만 입힌다
 * (INV-2 — 시간 텍스트는 서버 값 그대로). 동작 줄이기면 등장 없이 곧장 보인다. 답이 오기 전엔 안 보이게 두어,
 * 정지 → 모션으로 한 프레임 번쩍이는 것을 막는다. `index` 는 카드 순번이고 뒤따르는 거리 커넥터도 같은 값을 쓴다.
 */
export function RevealItem({
  revealing,
  index,
  children,
}: {
  /** 꺼져 있으면 아무것도 입히지 않는다(자식을 그대로 낸다). */
  revealing: boolean;
  index: number;
  children: ReactNode;
}): ReactElement {
  const reduce = useReduceMotion();
  if (!revealing) return <>{children}</>;
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
