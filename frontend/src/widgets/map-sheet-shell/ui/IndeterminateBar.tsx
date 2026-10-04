import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Animated, View, type LayoutChangeEvent } from 'react-native';

import { startUnlessReduceMotion } from '@/shared/lib/reduceMotion';

/**
 * TRIP-1205 · 진행 막대의 인디터미닛 머리+꼬리(Figma `4817:2695` fp-tail·fp-head). 부모 트랙(회색,
 * `overflow-hidden`)을 가득 채우는 절대 배치 레이어로, 머리(primary)+꼬리(primary-pale) 묶음이 트랙
 * 왼쪽 밖에서 오른쪽 밖까지 반복해서 흐른다. 세션 계약에 진행률이 없어 "얼마나"는 말하지 않고
 * "진행 중"만 보인다(INV-3 — 퍼센트·시간 없음).
 *
 * `Animated.loop` 의 자식을 네이티브 timing 하나로 두면 반복이 네이티브로 넘어간다(Skeleton 과 같은
 * 이유). 동작 줄이기면 흐르지 않고 트랙 가운데쯤에 멈춘 한 장면만 보인다.
 * ⚠️ 흐르는 모습은 jest 가 못 본다(6-b 육안).
 */

// Figma 치수 — 꼬리 left 28 w 28 · 머리 left 48 w 44 → 묶음 폭 92.
const GROUP_WIDTH = 92;
const SWEEP_MS = 1400;
const REDUCED_POSITION = 0.45;

export function IndeterminateBar(): ReactElement {
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(
    () =>
      startUnlessReduceMotion(
        Animated.loop(
          Animated.timing(progress, {
            toValue: 1,
            duration: SWEEP_MS,
            useNativeDriver: true,
          })
        ),
        () => progress.setValue(REDUCED_POSITION)
      ),
    [progress]
  );

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-GROUP_WIDTH, trackWidth],
  });

  return (
    <View
      className="absolute inset-0"
      onLayout={(e: LayoutChangeEvent) =>
        setTrackWidth(e.nativeEvent.layout.width)
      }
    >
      <Animated.View
        testID="generation-progress-indeterminate"
        style={{ width: GROUP_WIDTH, transform: [{ translateX }] }}
        className="h-full"
      >
        <View className="absolute left-[28px] h-full w-[28px] rounded-pill bg-primary-pale" />
        <View className="absolute left-[48px] h-full w-[44px] rounded-pill bg-primary" />
      </Animated.View>
    </View>
  );
}
