import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { NaverMapPathOverlay } from '@mj-studio/react-native-naver-map';

import { startUnlessReduceMotion } from '@/shared/lib/reduceMotion';

/** 경로 그려지기 기본 시간(ms) — 모션 명세 「완성 일정 공개」 0.65초. */
export const DRAW_PATH_DURATION_MS = 650;

// MapView 의 경로선 색과 같은 값(PIN_PRIMARY·PIN_WHITE). 순환 import 를 피하려 여기에 둔다.
const PRIMARY = '#FF385C';
const WHITE = '#FFFFFF';
// 알파 0 인 흰색 — "transparent" 같은 0 값은 iOS 가 변경 없음으로 무시해 기본색이 칠해진다(MapView 반경 원 주석).
const CLEAR = 'rgba(255,255,255,0)';

/**
 * TRIP-1385 · 경로선이 1번 핀에서 마지막 핀까지 그려지는 오버레이. 좌표를 자르지 않고 네이티브 `progress`(0→1)
 * 만 흘린다 — 지나온 구간(passedColor)만 primary 라 선이 자란다. 프레임마다 이 컴포넌트만 다시 그려지므로
 * 마커가 많은 MapView 는 흔들리지 않는다. 마운트 때 한 번만 재생한다(coords 가 바뀌어도 다시 안 돈다).
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
  const [progress, setProgress] = useState(0);
  const lengthRef = useRef(coords.length);
  lengthRef.current = coords.length;

  useEffect(() => {
    const value = new Animated.Value(0);
    let last: number | null = -1;
    const report = (p: number): void => {
      const count =
        p >= 1 ? null : Math.floor(p * (lengthRef.current - 1) + 1e-6) + 1;
      if (count !== last) {
        last = count;
        onReveal(count);
      }
    };
    const id = value.addListener(({ value: v }) => {
      setProgress(v);
      report(v);
    });
    const stop = startUnlessReduceMotion(
      Animated.timing(value, {
        toValue: 1,
        duration: durationMs,
        delay: delayMs,
        easing: Easing.inOut(Easing.ease),
        // progress 는 네이티브 뷰 prop 이라 JS 드라이버로만 흘릴 수 있다.
        useNativeDriver: false,
      }),
      () => {
        setProgress(1);
        onReveal(null);
      }
    );
    return () => {
      stop();
      value.removeListener(id);
    };
  }, [durationMs, delayMs, onReveal]);

  return (
    <NaverMapPathOverlay
      coords={coords}
      color={CLEAR}
      passedColor={PRIMARY}
      outlineColor={CLEAR}
      passedOutlineColor={WHITE}
      progress={progress}
      width={width}
      outlineWidth={1.6}
    />
  );
}
