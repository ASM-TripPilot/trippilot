import { useEffect, useState } from 'react';
import {
  runOnJS,
  runOnUI,
  useAnimatedScrollHandler,
  useSharedValue,
  type ScrollHandlerProcessed,
} from 'react-native-reanimated';

/**
 * 세로 스크롤 중이면 `hidden` — FAB 이 본문을 덮지 않게 숨기는 데 쓴다(TRIP-1435 Q-023 결정 1=A, TRIP-1555 공용화).
 * `onScroll` 이 올 때마다 타이머를 새로 걸어 마지막 이벤트로부터 `settleMs` 뒤에 다시 보인다(디바운스).
 * `keepVisible`(담은 곳 메뉴 열림)이면 스크롤 중이어도 숨기지 않는다.
 *
 * TRIP-1733 — `onScroll` 은 UI 스레드 worklet 핸들러다. `Animated.ScrollView`/`Animated.FlatList` 에만 꽂힌다.
 * JS 로는 "숨김 시작"·"복귀" 두 번만 건너온다(제스처당 2회). 타이머는 UI 런타임의 setTimeout(worklets 폴리필).
 */
export function useScrollHide(
  keepVisible = false,
  settleMs = 250
): { hidden: boolean; onScroll: ScrollHandlerProcessed } {
  const [scrolling, setScrolling] = useState(false);
  const active = useSharedValue(false);
  const timer = useSharedValue<ReturnType<typeof setTimeout> | null>(null);

  // ponytail: 폴리필 setTimeout 은 프레임(rAF) 단위라 복귀가 최대 1프레임(~16ms) 늦을 수 있다 — 체감 차이 없음.
  const onScroll = useAnimatedScrollHandler(() => {
    'worklet';
    if (!active.value) {
      active.value = true;
      runOnJS(setScrolling)(true);
    }
    if (timer.value !== null) clearTimeout(timer.value);
    timer.value = setTimeout(() => {
      active.value = false;
      timer.value = null;
      runOnJS(setScrolling)(false);
    }, settleMs);
  });

  useEffect(
    () => () => {
      // 5-c — `.value` 대신 `.get()`: React Compiler 가 이 정리 함수의 `.value` 를 메모 키로 삼아
      // 렌더마다 UI 스레드에서 읽던 것(dev 경고 "Reading from value during component render")을 막는다.
      runOnUI(() => {
        'worklet';
        const pending = timer.get();
        if (pending !== null) clearTimeout(pending);
      })();
    },
    [timer]
  );

  return { hidden: scrolling && !keepVisible, onScroll };
}
