import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/shared/lib/reduceMotion';

/** 카드 하나가 아래에서 올라오며 나타나는 시간(ms) — 모션 명세 「완성 일정 공개」(TRIP-1385·1386). */
const REVEAL_DURATION_MS = 450;
/** 카드 사이 간격(ms). */
const REVEAL_STAGGER_MS = 150;

/**
 * 완성 일정(h14, 첫 카드 500 = 경로 그리기 시작 0.5초 뒤)·여행 요약(j04, 첫 카드 1050 = 경로 그리기가 끝난 뒤)이
 * 함께 쓰는 "위에서부터 차례로 올라오는" 등장 래퍼. 보이는 값은 안 바꾸고 등장 방식만 입힌다(INV-2).
 *
 * TRIP-1641 · 래퍼는 어떤 상태에서도 같은 `Animated.View` 한 겹이다. 상태마다 Fragment/View/Animated.View 로
 * 요소 종류가 바뀌면 React 가 자식을 지우고 새로 만들어(재마운트) 카드가 깜빡였다 — 보임·숨김은 투명도로만 바꾼다.
 * 동작 줄이기 답이 오기 전엔 투명으로 둔다(정지 → 모션 한 프레임 번쩍임 방지). `revealing` 이 꺼져 있으면
 * 첫 렌더부터 보인다. 등장은 한 번만 시작하고 `index` 가 나중에 바뀌어도 다시 시작하지 않는다.
 */
export function RevealItem({
  index,
  firstDelayMs,
  revealing = true,
  children,
}: {
  /** 카드 순번 — 한 칸마다 150ms 늦게 나온다. */
  index: number;
  /** 첫 카드가 나오기까지의 지연(ms). */
  firstDelayMs: number;
  /** 꺼져 있으면 등장 없이 곧장 보인다. */
  revealing?: boolean;
  children: ReactNode;
}): ReactElement {
  const reduce = useReduceMotion();
  // 진행도 0(투명·아래) → 1(보임·제자리). 꺼진 채 마운트하면 첫 렌더부터 1.
  const progress = useSharedValue(revealing ? 0 : 1);
  const started = useRef(false);

  useEffect(() => {
    if (!revealing || reduce === true) {
      progress.value = 1;
      return;
    }
    if (reduce === null || started.current) return;
    started.current = true;
    progress.value = withDelay(
      firstDelayMs + index * REVEAL_STAGGER_MS,
      withTiming(1, { duration: REVEAL_DURATION_MS })
    );
  }, [reduce, revealing, index, firstDelayMs, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 25 }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}
