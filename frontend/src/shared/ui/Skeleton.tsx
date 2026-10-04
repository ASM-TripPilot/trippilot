import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

import { startUnlessReduceMotion } from '@/shared/lib/reduceMotion';

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
  /** 주면 상자 하나가 자식 묶음을 통째로 펄스시킨다(TRIP-1205 — 카드 여러 장을 루프 하나로). */
  children?: ReactNode;
}

export function Skeleton({
  testID,
  className,
  style,
  children,
}: SkeletonProps): ReactElement {
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.45, 1],
  });

  // loop 의 자식이 네이티브 timing 하나여야 반복이 네이티브로 넘어간다(sequence 면 JS 가 매 바퀴 재시작).
  useEffect(
    () =>
      startUnlessReduceMotion(
        Animated.loop(
          Animated.timing(progress, {
            toValue: 1,
            duration: 1600,
            useNativeDriver: true,
          })
        )
      ),
    [progress]
  );

  return (
    <Animated.View
      testID={testID}
      className={className}
      style={[style, { opacity }]}
    >
      {children}
    </Animated.View>
  );
}
