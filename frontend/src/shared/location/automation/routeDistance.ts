import type { AutomationConfig } from './config';

/**
 * TRIP-1336 · 원시 표본 → 세그먼트 분할 → 거리 (BR-U10-12·37·38·40).
 *
 * - 정확도 > maxAccuracyM 표본은 버린다.
 * - 표본 간격 > gapMs 또는 점프 > jumpM 이면 세그먼트를 끊는다 — 끊긴 곳은 잇지 않는다.
 * - 거리 = 세그먼트별 하버사인 누적(공백 구간 제외). **걸음 수·속도 함수를 두지 않는다**(INV-3).
 *
 * 표본의 `t`(epoch ms)는 분할 판정에만 쓰고 출력에 싣지 않는다.
 */

export interface RawSample {
  t: number;
  lat: number;
  lng: number;
  /** 수평 정확도(m). */
  acc: number;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

type SplitConfig = Pick<AutomationConfig, 'maxAccuracyM'> & {
  route: Pick<AutomationConfig['route'], 'gapMs' | 'jumpM'>;
};

export function splitSegments(
  samples: readonly RawSample[],
  config: SplitConfig
): RawSample[][] {
  const sorted = samples
    .filter((s) => s.acc <= config.maxAccuracyM)
    .slice()
    .sort((a, b) => a.t - b.t);
  const segments: RawSample[][] = [];
  let current: RawSample[] = [];
  for (const s of sorted) {
    const prev = current[current.length - 1];
    if (
      prev &&
      (s.t - prev.t > config.route.gapMs ||
        haversineM(prev, s) > config.route.jumpM)
    ) {
      segments.push(current);
      current = [];
    }
    current.push(s);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** 한 줄(세그먼트) 길이. */
export function pathLengthM(points: readonly GeoPoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += haversineM(points[i - 1], points[i]);
  }
  return sum;
}

/** 세그먼트별 길이의 합 — 세그먼트 사이(공백)는 더하지 않는다. */
export function routeDistanceM(
  segments: readonly (readonly GeoPoint[])[]
): number {
  return segments.reduce((sum, seg) => sum + pathLengthM(seg), 0);
}
