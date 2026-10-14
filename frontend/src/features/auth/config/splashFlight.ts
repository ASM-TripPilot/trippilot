// c01 스플래시 비행 모션의 상수와 항로 좌표 함수(TRIP-1383). RN 에는 SVG getPointAtLength 가 없어
// 항로(M55 230 C138.333 103.333 230 81.6668 330 165)의 3차 베지어 식을 직접 계산한다.
// 좌표·회전 함수는 reanimated UI 스레드(useAnimatedStyle)에서 불려 'worklet' 이다.

/** 비행 시간(ms) — 최소 노출 하한(SPLASH_MIN_VISIBLE_MS)과 같은 값이어야 비행이 끝까지 보인다. */
export const SPLASH_FLIGHT_MS = 1300;
/** 도착 핀 파동 시간(ms) — 비행이 끝난 뒤 1회. */
export const SPLASH_RIPPLE_MS = 700;
/** 하단 점 펄스 주기(ms)와 점 사이 엇갈림(ms). */
export const SPLASH_DOT_PERIOD_MS = 1000;
export const SPLASH_DOT_STAGGER_MS = 200;

export type Point = { x: number; y: number };

/** 항로 제어점 4개(고정값). */
export const FLIGHT_P0: Point = { x: 55, y: 230 };
export const FLIGHT_P1: Point = { x: 138.333, y: 103.333 };
export const FLIGHT_P2: Point = { x: 230, y: 81.6668 };
export const FLIGHT_P3: Point = { x: 330, y: 165 };

/** 진행률 t(0~1)에서의 항로 위 좌표. */
export function flightPoint(t: number): Point {
  'worklet';
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * 55 + b * 138.333 + c * 230 + d * 330,
    y: a * 230 + b * 103.333 + c * 81.6668 + d * 165,
  };
}

/** 진행률 t 에서 비행기 마커에 줄 회전각(도) — 접선 방향 + 마커 기본 방향(-45°) 보정 45. */
export function flightRotationDeg(t: number): number {
  'worklet';
  const u = 1 - t;
  const dx =
    3 * u * u * (138.333 - 55) +
    6 * u * t * (230 - 138.333) +
    3 * t * t * (330 - 230);
  const dy =
    3 * u * u * (103.333 - 230) +
    6 * u * t * (81.6668 - 103.333) +
    3 * t * t * (165 - 81.6668);
  return (Math.atan2(dy, dx) * 180) / Math.PI + 45;
}
