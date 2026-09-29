import { useEffect, useRef, type ReactElement } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

import { startUnlessReduceMotion } from '@/shared/motion/reduceMotion';

/**
 * 로딩 자리 회색 상자(TRIP-1125) — 투명도가 오르내리는 펄스만 맡는다. 색·크기·반경은 소비처
 * `className`/`style` 이 준다. `testID`·`className`·`style` 은 한 노드에 얹는다(자식 복제 금지 —
 * 소비처 테스트가 testID 개수를 센다). 동작 줄이기면 불투명 정지 상자다. 박자·진폭은 Figma 모션
 * 정의가 없어 발명값(6-b 육안 조정).
 */
export interface SkeletonProps {
  testID?: string;
  className?: string;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({
  testID,
  className,
  style,
}: SkeletonProps): ReactElement {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(
    () =>
      startUnlessReduceMotion(
        Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.45,
              duration: 800,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 1,
              duration: 800,
              useNativeDriver: true,
            }),
          ])
        )
      ),
    [opacity]
  );

  return (
    <Animated.View
      testID={testID}
      className={className}
      style={[style, { opacity }]}
    />
  );
}
