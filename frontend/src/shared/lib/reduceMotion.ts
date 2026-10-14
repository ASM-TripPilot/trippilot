import { useEffect, useState } from 'react';
import { AccessibilityInfo, type Animated } from 'react-native';

/**
 * 기기 "동작 줄이기" 공용 게이트(TRIP-1125). 켜져 있으면 `animation` 을 시작하지 않고 `onReduce` 만
 * 부른다(정지 모양을 보이는 자리에 둘 때). 답은 Promise 라 늦게 오므로, 그 전에 반환 함수(정리)가
 * 불리면 시작하지 않는다. 답을 모듈에 캐시하지 않는다 — 부를 때마다 새로 묻는다. 설정을 켜고 끄는
 * 순간의 실시간 반영(구독)은 범위 밖이다.
 */
export function startUnlessReduceMotion(
  animation: Animated.CompositeAnimation,
  onReduce?: () => void
): () => void {
  let active = true;
  void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
    if (!active) return;
    if (reduce) onReduce?.();
    else animation.start();
  });
  return () => {
    active = false;
    animation.stop();
  };
}

/**
 * reanimated 모션용 "동작 줄이기" 훅(TRIP-1383). 답이 오기 전엔 `null` — 호출 쪽은 그동안 모션 요소를 그리지
 * 않아 정지→모션으로 한 프레임 번쩍이는 것을 피한다. 위 함수와 같은 원천(AccessibilityInfo)이라 같은 규칙이다
 * (reanimated 의 useReducedMotion 은 jest-expo 의 reanimated 목에 없어 쓰지 않는다). 마운트 때 한 번만 묻는다.
 */
export function useReduceMotion(): boolean | null {
  const [reduce, setReduce] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) setReduce(v);
    });
    return () => {
      active = false;
    };
  }, []);
  return reduce;
}
