import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { useReduceMotion } from '@/shared/lib/reduceMotion';

import {
  FLIGHT_P3,
  SPLASH_FLIGHT_MS,
  SPLASH_RIPPLE_MS,
  flightPoint,
  flightRotationDeg,
} from '../config/splashFlight';

// 스플래시 상단 비행경로 일러스트(c01 IO). 점선 곡선 + 종이비행기 마커 + 목적지 핀 2개는
// 하나의 장식 조합이라 이 존 박스 안에서만 절대좌표 오버레이를 유지한다(SKILL 4단계 예외 —
// 장식은 absolute 허용). 좌표·색은 Figma 에셋(path-curve·airplane-marker·pin-small/large.svg)
// 을 그대로 옮긴 raw 값이다.

function FlightPathCurve() {
  return (
    <Svg
      width={390}
      height={300}
      viewBox="0 0 390 300"
      fill="none"
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      <Path
        d="M55 230C138.333 103.333 230 81.6668 330 165"
        stroke="#FF385C"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeDasharray="2 9"
      />
    </Svg>
  );
}

function AirplaneMarker() {
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34" fill="none">
      <Path d="M30 4L4 15L15 19L19 30L30 4Z" fill="#FF385C" />
      <Path d="M30 4L15 19L19 30L30 4Z" fill="#FF8298" />
    </Svg>
  );
}

function PinSmall() {
  return (
    <Svg width={22} height={28} viewBox="0 0 22 28" fill="none">
      <Path
        d="M11 0.777832C5.4 0.777832 0.888885 5.05561 0.888885 10.5001C0.888885 17.1112 11 27.2223 11 27.2223C11 27.2223 21.1111 17.1112 21.1111 10.5001C21.1111 5.05561 16.6 0.777832 11 0.777832Z"
        fill="#FF385C"
        stroke="#ffffff"
        strokeWidth={1.86667}
      />
      <Path
        d="M11 13.7667C12.8041 13.7667 14.2667 12.3042 14.2667 10.5001C14.2667 8.69593 12.8041 7.2334 11 7.2334C9.19587 7.2334 7.73334 8.69593 7.73334 10.5001C7.73334 12.3042 9.19587 13.7667 11 13.7667Z"
        fill="#ffffff"
      />
    </Svg>
  );
}

function PinLarge() {
  return (
    <Svg width={27} height={34} viewBox="0 0 27 34" fill="none">
      <Path
        d="M13.5 0.944336C6.70001 0.944336 1.22223 6.13878 1.22223 12.7499C1.22223 20.7777 13.5 33.0554 13.5 33.0554C13.5 33.0554 25.7778 20.7777 25.7778 12.7499C25.7778 6.13878 20.3 0.944336 13.5 0.944336Z"
        fill="#FF385C"
        stroke="#ffffff"
        strokeWidth={2.26667}
      />
      <Path
        d="M13.5 16.9053C15.7951 16.9053 17.6556 15.0448 17.6556 12.7498C17.6556 10.4547 15.7951 8.59424 13.5 8.59424C11.205 8.59424 9.34445 10.4547 9.34445 12.7498C9.34445 15.0448 11.205 16.9053 13.5 16.9053Z"
        fill="#ffffff"
      />
    </Svg>
  );
}

// 동작 줄이기: 전부 정지 — 지금의 정지 그림(비행기는 출발점, 핀 둘, 전체 항로). 파동은 없다.
function StaticIllustration() {
  return (
    <View testID="shell-splash-illustration" className="h-[300px] w-full">
      <FlightPathCurve />
      <View
        testID="shell-splash-plane"
        className="absolute left-[40px] top-[216px]"
      >
        <AirplaneMarker />
      </View>
      <View className="absolute left-[175px] top-[92px]">
        <PinSmall />
      </View>
      <View className="absolute left-[316px] top-[132px]">
        <PinLarge />
      </View>
    </View>
  );
}

const RIPPLE_MIN_R = 6;
const RIPPLE_MAX_R = 36;
const PIN_ORIGIN = '50% 100%';

// 진행률 p 가 [from, peak, to] 를 지나며 0→1.15→1 로 튄다.
function popScale(p: number, from: number, peak: number, to: number) {
  'worklet';
  return interpolate(p, [from, peak, to], [0, 1.15, 1], 'clamp');
}

// 비행기가 점선 항로를 따라 1회 날아 큰 핀에 닿고, 닿은 자리에서 파동이 1회 번진다(TRIP-1383).
function FlyingIllustration() {
  const progress = useSharedValue(0);
  const ripple = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: SPLASH_FLIGHT_MS,
      easing: Easing.inOut(Easing.ease),
    });
    ripple.value = withDelay(
      SPLASH_FLIGHT_MS,
      withTiming(1, {
        duration: SPLASH_RIPPLE_MS,
        easing: Easing.out(Easing.quad),
      })
    );
  }, [progress, ripple]);

  // 항로는 x 가 단조 증가라 비행기 x 까지만 잘라 보이면 "지나간 만큼만" 이 된다.
  const trailStyle = useAnimatedStyle(() => ({
    width: flightPoint(progress.value).x + 2,
  }));
  const planeStyle = useAnimatedStyle(() => {
    const pt = flightPoint(progress.value);
    return {
      opacity: interpolate(progress.value, [0.85, 0.97], [1, 0], 'clamp'),
      transform: [
        { translateX: pt.x - 17 },
        { translateY: pt.y - 17 },
        { rotate: `${flightRotationDeg(progress.value)}deg` },
      ],
    };
  });
  const smallPinStyle = useAnimatedStyle(() => ({
    transform: [{ scale: popScale(progress.value, 0.42, 0.5, 0.54) }],
  }));
  const largePinStyle = useAnimatedStyle(() => ({
    transform: [{ scale: popScale(progress.value, 0.88, 0.96, 1) }],
  }));
  const rippleStyle = useAnimatedStyle(() => {
    const r = interpolate(ripple.value, [0, 1], [RIPPLE_MIN_R, RIPPLE_MAX_R]);
    return {
      width: r * 2,
      height: r * 2,
      borderRadius: r,
      left: FLIGHT_P3.x - 0.5 - r,
      top: FLIGHT_P3.y + 1 - r,
      opacity:
        ripple.value === 0 ? 0 : interpolate(ripple.value, [0, 1], [0.7, 0]),
    };
  });

  return (
    <View testID="shell-splash-illustration" className="h-[300px] w-full">
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            height: 300,
            overflow: 'hidden',
          },
          trailStyle,
        ]}
      >
        <FlightPathCurve />
      </Animated.View>
      <Animated.View
        testID="shell-splash-arrival-ripple"
        pointerEvents="none"
        className="border-2 border-primary"
        style={[{ position: 'absolute' }, rippleStyle]}
      />
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 175,
            top: 92,
            transformOrigin: PIN_ORIGIN,
          },
          smallPinStyle,
        ]}
      >
        <PinSmall />
      </Animated.View>
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 316,
            top: 132,
            transformOrigin: PIN_ORIGIN,
          },
          largePinStyle,
        ]}
      >
        <PinLarge />
      </Animated.View>
      <Animated.View
        testID="shell-splash-plane"
        style={[{ position: 'absolute', left: 0, top: 0 }, planeStyle]}
      >
        <AirplaneMarker />
      </Animated.View>
    </View>
  );
}

export function SplashIllustration() {
  const reduce = useReduceMotion();
  // 답이 오기 전(마운트 직후 한두 프레임)은 빈 박스 — 정지 그림이 번쩍였다 모션으로 바뀌지 않게 한다.
  if (reduce === null) {
    return (
      <View testID="shell-splash-illustration" className="h-[300px] w-full" />
    );
  }
  return reduce ? <StaticIllustration /> : <FlyingIllustration />;
}
