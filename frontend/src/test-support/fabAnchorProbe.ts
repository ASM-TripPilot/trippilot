import { act, fireEvent, screen } from '@testing-library/react-native';
import {
  getAnimatedStyle,
  isSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import type { ReactTestInstance } from 'react-test-renderer';

/**
 * 바텀시트 윗변을 따라가는 FAB 앵커(reanimated Animated.View)를 jest 에서 읽는 프로브 —
 * `LiveHubView.test`(TRIP-1083) 와 `TripRecordsView.test`(TRIP-1088) 가 같은 함수를 복사해 쓰던 것을 한 곳에.
 *
 * ⚠️ 관측은 getAnimatedStyle + 가짜 타이머로만 — host `props.style` 은 첫 렌더 값에 굳는다(02a ★1·★2).
 * 호출하는 테스트가 `jest.useFakeTimers()` 를 켜 둬야 한다. 통과형 시트 목이 `animatedPosition` 을 host 에 그대로
 * 남기므로 `.value` 를 직접 써서 "시트가 움직였다"를 흉내 낸다(02a ★7). 실제 드래그 추종·첫 프레임은 6-b 실기.
 */

export const FRAME_MS = 100;

/** snapPoints 를 가진 host 노드 = 시트 본체(통과형 목이 props 를 host 에 펼친다). */
export function sheetHost(): ReactTestInstance {
  const host = screen.root
    .findAll((node) => Array.isArray(node.props?.snapPoints))
    .find((node) => typeof node.type === 'string');
  if (!host) throw new Error('시트 host 노드가 없다');
  return host;
}

export function sheetPosition(): SharedValue<number> {
  const position = sheetHost().props.animatedPosition as unknown;
  if (!isSharedValue(position)) {
    throw new Error(
      '시트(BottomSheet)에 animatedPosition 상자가 실려 있지 않다'
    );
  }
  return position as SharedValue<number>;
}

/**
 * 프레임을 흘린다 — reanimated 는 jest 에서 스타일 재계산을 타이머로 돌린다(02a ★2). 원인 동작과
 * **다른 act** 로 부른다: 상태가 바뀌어 스타일이 다시 등록되는 것은 원인 act 가 끝날 때(리렌더·
 * effect)라, 같은 act 안에서 흘리면 등록 전 타이머만 돈다(02a §5 실측).
 */
export function flushFrames(): void {
  act(() => {
    jest.advanceTimersByTime(FRAME_MS);
  });
}

/** 시트 윗변을 y 로 옮긴다(gorhom 이 매 프레임 하는 일). */
export function moveSheet(y: number): void {
  const position = sheetPosition();
  act(() => {
    position.value = y;
  });
  flushFrames();
}

/** 오버레이 줄(‹ + 일차 칩)이 기기에서 잰 자리 — 하단 = y + height. */
export function layoutOverlay(
  overlayRowTestId: string,
  box: { y: number; height: number; width: number }
): void {
  act(() => {
    fireEvent(screen.getByTestId(overlayRowTestId), 'layout', {
      nativeEvent: { layout: { x: 16, ...box } },
    });
  });
  flushFrames();
}

/** 앵커의 병합 style(static + animated) — 첫 렌더에 굳은 props.style 이 아니다. */
export function anchorStyle(anchorTestId: string): Record<string, unknown> {
  return getAnimatedStyle(screen.getByTestId(anchorTestId)) as Record<
    string,
    unknown
  >;
}

/** 앵커 윗변 y = top(없으면 0) + transform translateY 합. */
export function anchorTop(anchorTestId: string): number {
  const style = anchorStyle(anchorTestId);
  const top = typeof style.top === 'number' ? style.top : 0;
  const transform = Array.isArray(style.transform)
    ? (style.transform as Record<string, unknown>[])
    : [];
  const shift = transform.reduce<number>(
    (sum, step) =>
      sum + (typeof step.translateY === 'number' ? step.translateY : 0),
    0
  );
  return top + shift;
}
