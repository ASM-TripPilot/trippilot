import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Text } from 'react-native';

import { useReduceMotion } from '@/shared/lib/reduceMotion';

/**
 * TRIP-1665 · 매거진 연출 3종 — 사진 천천히 확대(켄번스)·스티커 팝·형광펜. 모두 마운트 시 1회.
 * 초심자용: `useReduceMotion()` 은 기기 "동작 줄이기" 답이다. true 면 움직임 없이 **끝 모습**, 답이 오기 전(null)엔
 * 시작 전 모습(스티커·형광펜은 숨김)으로 두고, false 일 때만 재생한다 — 안 그러면 끝 모습이 먼저 번쩍였다 사라진다.
 * 규칙: 애니메이션 콜백(worklet) 안에서 모듈 상수·기본 매개변수를 쓰지 않는다(기기에서 UI 스레드가 죽는데 jest 는 모른다).
 */

const KEN_BURNS_MS = 10_000;

/** 사진을 1.02 → 1.14 배로 천천히 키운다. 부모에 `overflow-hidden` 이 있어야 넘친 부분이 잘린다. */
export function KenBurns({ children }: { children: ReactNode }): ReactElement {
  const reduce = useReduceMotion();
  const scale = useSharedValue(1.02);
  useEffect(() => {
    if (reduce === true) scale.value = 1.14;
    else if (reduce === false)
      scale.value = withTiming(1.14, { duration: KEN_BURNS_MS });
  }, [reduce, scale]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** 표지 스티커가 작게 시작해 살짝 부풀었다가(1.14) 자리를 잡는다. 답 전엔 안 보인다. */
export function StickerPop({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const reduce = useReduceMotion();
  const pop = useSharedValue(0);
  useEffect(() => {
    if (reduce === true) pop.value = 1;
    else if (reduce === false)
      pop.value = withDelay(
        350,
        withSequence(
          withTiming(1.14, { duration: 260 }),
          withTiming(1, { duration: 160 })
        )
      );
  }, [reduce, pop]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, pop.value),
    transform: [
      { scale: 0.4 + 0.6 * pop.value },
      { rotate: `${-14 + 10 * pop.value}deg` },
    ],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * 인용문의 형광펜 구간(글자 뒤 배경색). 중첩 `<Text>` 라 iOS 에선 애니메이션 스타일이 안 먹을 수 있어(jest 사각)
 * 켜는 시점만 타이머로 정한다 — 폭이 그어지는 효과는 후속. 노드의 글자 내용은 그대로라 표시본 일치를 해치지 않는다.
 */
export function Highlight({
  color,
  children,
}: {
  color: string;
  children: string;
}): ReactElement {
  const reduce = useReduceMotion();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (reduce !== false) return;
    const id = setTimeout(() => setArmed(true), 900);
    return () => clearTimeout(id);
  }, [reduce]);
  const on = reduce === true || armed;
  return (
    <Text style={{ backgroundColor: on ? color : 'transparent' }}>
      {children}
    </Text>
  );
}
