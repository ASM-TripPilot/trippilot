import type { ReactElement } from 'react';
import { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { NaverMapPathOverlay } from '@mj-studio/react-native-naver-map';

import { onReduceMotionAnswer } from '@/shared/lib/reduceMotion';
import { COLOR_TOKENS } from '../config';

/** 경로 그려지기 기본 시간(ms) — 모션 명세 「완성 일정 공개」 0.65초. */
export const DRAW_PATH_DURATION_MS = 650;

// MapView 의 경로선 색과 같은 값(PIN_PRIMARY·PIN_WHITE). 순환 import 를 피하려 여기에 둔다.
const PRIMARY = COLOR_TOKENS.primary;
const WHITE = COLOR_TOKENS.canvas;
// 알파 0 인 흰색 — "transparent" 같은 0 값은 iOS 가 변경 없음으로 무시해 기본색이 칠해진다(MapView 반경 원 주석).
const CLEAR = 'rgba(255,255,255,0)';

// 함수 컴포넌트라 ref 가 네이티브 뷰까지 안 가지만, reanimated 4 가 findHostInstance 폴백으로 첫 호스트 뷰를 찾는다(patch 불요 — TRIP-1736).
const AnimatedPathOverlay =
  Animated.createAnimatedComponent(NaverMapPathOverlay);

/**
 * TRIP-1385 · 경로선이 1번 핀에서 마지막 핀까지 그려지는 오버레이. 좌표를 자르지 않고 네이티브 `progress`(0→1)
 * 만 흘린다 — 지나온 구간(passedColor)만 primary 라 선이 자란다. progress 는 reanimated 가 UI 스레드에서 갱신해
 * React 렌더가 없다(TRIP-1736). 마운트 때 한 번만 재생한다(coords 가 바뀌어도 다시 안 돈다).
 * 동작 줄이기면 곧장 progress 1(완성 경로). `onReveal` 은 경로가 닿은 핀 수를 알린다(끝나면 null=전부).
 */
export function DrawnPathOverlay({
  coords,
  width,
  durationMs,
  delayMs,
  onReveal,
}: {
  coords: { latitude: number; longitude: number }[];
  width: number;
  durationMs: number;
  delayMs: number;
  onReveal: (count: number | null) => void;
}): ReactElement {
  const progress = useSharedValue(0);
  const last = coords.length - 1;

  useEffect(() => {
    const cancel = onReduceMotionAnswer((reduce) => {
      if (reduce) {
        progress.value = 1;
        // 반응식은 첫 계산(null)을 이전값(null)과 같다고 보고 안 부르므로 여기서 직접 알린다.
        onReveal(null);
        return;
      }
      progress.value = withDelay(
        delayMs,
        withTiming(1, {
          duration: durationMs,
          easing: Easing.inOut(Easing.ease),
        })
      );
    });
    return () => {
      cancel();
      cancelAnimation(progress);
    };
  }, [durationMs, delayMs, onReveal, progress]);

  // 경로가 닿은 핀 수가 바뀔 때만 JS 로 넘긴다. `last` 가 클로저라 재생 중 좌표가 바뀌면 최신 수로 다시 센다.
  useAnimatedReaction(
    () =>
      progress.value >= 1 ? null : Math.floor(progress.value * last + 1e-6) + 1,
    (count, prev) => {
      if (count !== prev) runOnJS(onReveal)(count);
    }
  );

  const animatedProps = useAnimatedProps(() => ({ progress: progress.value }));

  return (
    <AnimatedPathOverlay
      coords={coords}
      color={CLEAR}
      passedColor={PRIMARY}
      outlineColor={CLEAR}
      passedOutlineColor={WHITE}
      animatedProps={animatedProps}
      width={width}
      outlineWidth={1.6}
    />
  );
}
