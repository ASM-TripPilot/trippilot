import { useState } from 'react';
import {
  runOnJS,
  useAnimatedReaction,
  type SharedValue,
} from 'react-native-reanimated';

import { isOverDeleteZone } from './dragDelete';

/**
 * TRIP-1246 · 끌던 카드가 하단 삭제 영역 위에 있는지를 **손가락이 닿아 있는 동안** 추적한다.
 *
 * 라이브러리는 놓는 순간 손가락 좌표를 안 주고(`onDragEnd` 는 from/to 뿐), 놓은 뒤엔 카드가 제자리로 되돌아가는
 * 스프링을 시작해 그 값을 JS 가 늦게 읽으면 이미 움직여 있다. 그래서 `onAnimValInit` 로 받은 공유값
 * (`hoverOffset`·`activeCellSize`·`isTouchActiveNative`)을 UI 스레드 반응식으로 보다가 바뀔 때만 JS 로 알린다 —
 * 손을 뗀 뒤(`isTouchActiveNative` 거짓)엔 갱신을 멈춰 마지막 터치 중 값이 남는다.
 * (node_modules `DraggableFlatList.tsx` `onEnd` · `animatedValueContext.tsx` `hoverOffset`)
 */

/** 라이브러리 `onAnimValInit` 가 주는 값 중 쓰는 것만. */
export interface HoverAnimVals {
  hoverOffset: SharedValue<number>;
  activeCellSize: SharedValue<number>;
  isTouchActiveNative: SharedValue<boolean>;
}

export function useDeleteZoneHover(params: {
  scrollOffset: SharedValue<number>;
  viewportHeight: SharedValue<number>;
  bottomInset: number;
  /** 터치 중 값이 바뀔 때만 불린다(JS 스레드). */
  onChange: (over: boolean) => void;
}): {
  /** `NestableDraggableFlatList` 의 `onAnimValInit` 에 넘긴다. */
  onAnimValInit: (vals: HoverAnimVals) => void;
} {
  const { scrollOffset, viewportHeight, bottomInset, onChange } = params;
  const [vals, setVals] = useState<HoverAnimVals | null>(null);

  useAnimatedReaction(
    () => {
      if (vals === null || !vals.isTouchActiveNative.value) return null;
      return isOverDeleteZone({
        hoverTop: vals.hoverOffset.value,
        scrollOffset: scrollOffset.value,
        cardSize: vals.activeCellSize.value,
        viewportHeight: viewportHeight.value,
        bottomInset,
      });
    },
    (cur, prev) => {
      if (cur !== null && cur !== prev) runOnJS(onChange)(cur);
    },
    [vals, bottomInset]
  );

  return { onAnimValInit: setVals };
}
