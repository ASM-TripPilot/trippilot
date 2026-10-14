import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/shared/lib/reduceMotion';

import {
  SPLASH_DOT_PERIOD_MS,
  SPLASH_DOT_STAGGER_MS,
} from '../config/splashFlight';

// 하단 진행 점 하나(TRIP-1383). 부트스트랩이 끝나 스플래시가 내려갈 때까지 불투명 0.35↔1 을 반복한다
// (withRepeat — features 층은 setInterval 금지). index 만큼 엇갈려 파도처럼 지나간다.
// 동작 줄이기면 시작하지 않고 지금의 정지 점(불투명 0.45)을 그대로 둔다.

function StaticDot() {
  return (
    <View
      testID="shell-splash-progress-dot"
      className="h-[7px] w-[7px] rounded-full bg-primary opacity-[0.45]"
    />
  );
}

function PulsingDot({ index }: { index: number }) {
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    const half = SPLASH_DOT_PERIOD_MS / 2;
    opacity.value = withDelay(
      index * SPLASH_DOT_STAGGER_MS,
      withRepeat(
        withSequence(
          withTiming(1, { duration: half }),
          withTiming(0.35, { duration: half })
        ),
        -1
      )
    );
  }, [index, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      testID="shell-splash-progress-dot"
      className="h-[7px] w-[7px] rounded-full bg-primary"
      style={style}
    />
  );
}

export function SplashProgressDot({ index }: { index: number }) {
  // 답이 오기 전엔 정지 점 — 동작 줄이기면 그대로 남고, 아니면 곧 펄스로 바뀐다.
  return useReduceMotion() === false ? (
    <PulsingDot index={index} />
  ) : (
    <StaticDot />
  );
}
