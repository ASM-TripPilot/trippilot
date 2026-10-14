import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { Animated, Easing, Text } from 'react-native';

import { countUpText, isCountable } from '@/shared/lib/countUp';
import { useReduceMotion } from '@/shared/lib/reduceMotion';

/** 카운트업 시간(ms) — 모션 명세 「여행 요약」 0.9초 ease-out. */
export const COUNT_UP_DURATION_MS = 900;

/**
 * TRIP-1386 · 요약 숫자가 0 에서 목표값까지 올라가는 Text. 표시 문자열(`12`·`38km`)의 숫자 앞부분만 올리고 접미사는
 * 그대로라 형식이 흔들리지 않는다. 0·`—`(측정 못 함) 같은 값은 애니메이션 없이 그대로(가짜 숫자 금지).
 * 동작 줄이기면 처음부터 최종값. 답이 오기 전엔 안 보이게 두어 0 → 최종값으로 번쩍이는 것을 막는다.
 * 목표 문자열이 바뀌지 않는 한 한 번만 재생한다. 끝 값은 항상 입력 문자열 그대로(INV-2).
 */
export function CountUpText({
  value,
  className,
}: {
  value: string;
  className?: string;
}): ReactElement {
  const reduce = useReduceMotion();
  const [progress, setProgress] = useState(0);
  const animate = reduce === false && isCountable(value);

  useEffect(() => {
    if (!animate) return;
    const anim = new Animated.Value(0);
    setProgress(0);
    const id = anim.addListener(({ value: v }) => setProgress(v));
    const timing = Animated.timing(anim, {
      toValue: 1,
      duration: COUNT_UP_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      // 값은 문자열로 그리는 JS 상태라 네이티브 드라이버로 흘릴 수 없다.
      useNativeDriver: false,
    });
    timing.start(({ finished }) => {
      if (finished) setProgress(1);
    });
    return () => {
      timing.stop();
      anim.removeListener(id);
    };
  }, [animate, value]);

  const shown = animate ? countUpText(value, progress) : value;
  return (
    <Text
      className={reduce === null ? `${className ?? ''} opacity-0` : className}
    >
      {shown}
    </Text>
  );
}
