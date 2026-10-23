import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import {
  TOUR_MOTION_MS,
  TOUR_RESET_DELAY_MS,
  tourMotionFrame,
  type TourMotionFrame,
} from '../model/tourMotion';

/**
 * 한 장의 재생 시계(TRIP-1596 · S2). 장마다 하나 — 공유 값(UI 스레드가 직접 읽는 숫자) 한 개를 0→2400ms 로 흘리면,
 * 장 안의 모든 움직임이 그 값을 `tourMotionFrame` 에 넣어 읽는다. 값 표는 `model/tourMotion.ts`, 여기는 "언제 시계를 돌리나"만 정한다.
 *
 *  - 동작 줄이기 `true`: 활성 여부와 무관하게 끝 프레임에 고정(재생 없음).
 *  - 답 전(`null`): 시작 프레임. 무대는 그려 둔다(S1 쿼리가 죽지 않게 — 숨기지 않고 투명하게).
 *  - `false`: 장이 활성이 될 때마다 0 부터 재생. 떠날 땐 건드리지 않고(슬라이드 중 빈 무대 방지) `TOUR_RESET_DELAY_MS` 뒤 시작 프레임으로.
 */
const TourMotionContext = createContext<{
  page: number;
  frame: SharedValue<TourMotionFrame>;
} | null>(null);

function useTourMotion() {
  const ctx = useContext(TourMotionContext);
  if (!ctx) throw new Error('TourMotion 밖에서 모션 조각을 그릴 수 없다');
  return ctx;
}

export function TourPageMotion({
  page,
  active,
  reduce,
  children,
}: {
  page: number;
  active: boolean;
  reduce: boolean | null;
  children: ReactNode;
}): ReactElement {
  const clock = useSharedValue(0);
  const frame = useDerivedValue(() => tourMotionFrame(page, clock.value));
  const wasActive = useRef(false);

  useEffect(() => {
    if (reduce === true) {
      cancelAnimation(clock);
      clock.value = TOUR_MOTION_MS;
    } else if (reduce === null) {
      clock.value = 0;
    } else if (active) {
      clock.value = 0;
      clock.value = withTiming(TOUR_MOTION_MS, {
        duration: TOUR_MOTION_MS,
        easing: Easing.linear,
      });
    } else if (wasActive.current) {
      clock.value = withDelay(
        TOUR_RESET_DELAY_MS,
        withTiming(0, { duration: 0 })
      );
    }
    wasActive.current = reduce === false && active;
  }, [active, reduce, clock]);

  return (
    <TourMotionContext.Provider value={{ page, frame }}>
      {children}
    </TourMotionContext.Provider>
  );
}

/** 장별 조각 하나 — 불투명도·세로 이동·확대를 `id` 로 시계에서 읽는다. 레이아웃은 `style`(NativeWind className 은 jest 가 값으로 못 읽는다). */
export function TourMotionPiece({
  id,
  style,
  children,
}: {
  id: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}): ReactElement {
  const { page, frame } = useTourMotion();
  const animated = useAnimatedStyle(() => {
    const p = frame.value.items[id];
    return {
      opacity: p.opacity,
      transform: [{ translateY: p.translateY }, { scale: p.scale }],
    };
  });
  return (
    <Animated.View
      testID={`onboarding-tour-motion-${page}-${id}`}
      style={[style, animated]}
    >
      {children}
    </Animated.View>
  );
}

/** 정류장/도착 핀. */
export function TourMotionStop({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}): ReactElement {
  const { page, frame } = useTourMotion();
  const animated = useAnimatedStyle(() => {
    const p = frame.value.stop;
    return {
      opacity: p.opacity,
      transform: [{ translateY: p.translateY }],
    };
  });
  return (
    <Animated.View
      testID={`onboarding-tour-stop-${page}`}
      style={[style, animated]}
    >
      {children}
    </Animated.View>
  );
}

/** 점선 경로 클립 — 폭만큼만 안쪽 점선이 드러난다(안쪽 Svg 는 원래 크기 그대로). */
export function TourMotionRoute({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}): ReactElement {
  const { page, frame } = useTourMotion();
  const animated = useAnimatedStyle(() => ({
    width: frame.value.routeClipWidth,
  }));
  return (
    <Animated.View
      testID={`onboarding-tour-route-${page}`}
      style={[style, { overflow: 'hidden' }, animated]}
    >
      {children}
    </Animated.View>
  );
}
