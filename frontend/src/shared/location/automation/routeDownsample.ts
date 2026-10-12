import type { AutomationConfig } from './config';
import { encodePolyline } from './polyline';
import {
  haversineM,
  pathLengthM,
  routeDistanceM,
  splitSegments,
  type GeoPoint,
  type RawSample,
} from './routeDistance';

/**
 * TRIP-1336 · 하루치 원시 표본 → 업로드 본문(§12.3) — NFR P-PRIV-U10-1 파이프라인.
 *
 *  1. 세그먼트 분할(정확도 필터 포함)             BR-U10-12·37
 *  2. 거리 = 배제 전 원시 기준 세그먼트 합       BR-U10-38
 *  3. 닻 = 체류 지점(D_stop 안 T_stop 이상) 중심 + 원시 세그먼트 양 끝점
 *  4. 닻 배제 = 어떤 닻이든 R_priv 안의 점 제거(남은 점 < 2 세그먼트 버림)
 *  5. 세그먼트마다 지역 평면 투영 후 RDP(ε)
 *  6. 세그먼트 > S_max 면 긴 S_max 개만 · 점 > N_max 면 ε×1.5 로 5 반복
 *  7. 인코딩(1e-5)
 *
 * 출력에 시각·속도·걸음 수 필드가 없다(INV-3 · BR-U10-40). 포그라운드 전용 · 결정론.
 */

export interface RouteDayBody {
  segments: string[];
  distanceM: number;
  rawPointCount: number;
  storedPointCount: number;
}

type RouteConfig = Pick<AutomationConfig, 'maxAccuracyM' | 'route'>;

/** 테스트·디버그용 중간 산출물(인코딩 전). */
export interface RoutePipeline {
  rawSegments: RawSample[][];
  anchors: GeoPoint[];
  kept: GeoPoint[][];
  simplified: GeoPoint[][];
  epsilonM: number;
  distanceM: number;
  rawPointCount: number;
}

export function runRoutePipeline(
  samples: readonly RawSample[],
  config: RouteConfig
): RoutePipeline {
  const rawSegments = splitSegments(samples, config);
  const rawPointCount = rawSegments.reduce((n, s) => n + s.length, 0);
  const distanceM = routeDistanceM(rawSegments);

  const anchors: GeoPoint[] = [];
  for (const seg of rawSegments) {
    anchors.push(...stayPoints(seg, config));
    anchors.push(toPoint(seg[0]), toPoint(seg[seg.length - 1]));
  }

  let kept = rawSegments
    .map((seg) =>
      seg
        .filter((p) =>
          anchors.every((a) => haversineM(a, p) > config.route.privacyRadiusM)
        )
        .map(toPoint)
    )
    .filter((seg) => seg.length >= 2);

  if (kept.length > config.route.maxSegments) {
    const longest = new Set(
      kept
        .map((seg, i) => ({ i, len: pathLengthM(seg) }))
        .sort((a, b) => b.len - a.len || a.i - b.i)
        .slice(0, config.route.maxSegments)
        .map((x) => x.i)
    );
    kept = kept.filter((_, i) => longest.has(i));
  }

  let epsilonM: number = config.route.toleranceM;
  let simplified = kept.map((seg) => rdp(seg, epsilonM));
  while (count(simplified) > config.route.maxPoints) {
    epsilonM *= 1.5;
    simplified = kept.map((seg) => rdp(seg, epsilonM));
  }

  return {
    rawSegments,
    anchors,
    kept,
    simplified,
    epsilonM,
    distanceM,
    rawPointCount,
  };
}

export function downsampleRoute(
  samples: readonly RawSample[],
  config: RouteConfig
): RouteDayBody {
  const p = runRoutePipeline(samples, config);
  return {
    segments: p.simplified.map((seg) => encodePolyline(seg)),
    // 배제·단순화는 경로를 짧게만 만든다 — 올림해 "거리 ≥ 폴리라인 길이"를 정수에서도 지킨다.
    distanceM: Math.ceil(p.distanceM),
    rawPointCount: p.rawPointCount,
    storedPointCount: count(p.simplified),
  };
}

const toPoint = (s: GeoPoint): GeoPoint => ({ lat: s.lat, lng: s.lng });
const count = (segs: readonly (readonly GeoPoint[])[]) =>
  segs.reduce((n, s) => n + s.length, 0);

/** stay-point detection — 시각 간격을 그대로 쓴다(점 두 개뿐인 긴 정지도 닻). */
function stayPoints(
  seg: readonly RawSample[],
  config: RouteConfig
): GeoPoint[] {
  const out: GeoPoint[] = [];
  let i = 0;
  while (i < seg.length) {
    let j = i + 1;
    while (
      j < seg.length &&
      haversineM(seg[i], seg[j]) <= config.route.stopRadiusM
    )
      j += 1;
    if (seg[j - 1].t - seg[i].t >= config.route.stopMs) {
      let lat = 0;
      let lng = 0;
      for (let k = i; k < j; k += 1) {
        lat += seg[k].lat;
        lng += seg[k].lng;
      }
      out.push({ lat: lat / (j - i), lng: lng / (j - i) });
      i = j;
    } else {
      i += 1;
    }
  }
  return out;
}

/** 지역 평면 투영(등장방형, 세그먼트 첫 점 기준, 미터). */
export function projector(origin: GeoPoint): (p: GeoPoint) => [number, number] {
  const kx = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = 110_540;
  return (p) => [(p.lng - origin.lng) * kx, (p.lat - origin.lat) * ky];
}

export function pointToSegmentM(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const u =
    len2 === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)
        );
  return Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dy));
}

/**
 * RDP 는 지그재그(모든 점이 ε 밖)에서 분할이 한쪽으로 쏠려 O(n²)이 된다(20,000점 실측 2분).
 * 세그먼트를 RDP_CHUNK 점 단위로 끊어 각각 단순화하고 경계 점을 공유한다 — 모든 점이 자기 조각의
 * 폴리라인에서 ε 안이라는 보장은 그대로이고, 최악 비용이 n·RDP_CHUNK 로 묶인다.
 */
const RDP_CHUNK = 512;

function rdp(points: readonly GeoPoint[], epsilonM: number): GeoPoint[] {
  if (points.length <= RDP_CHUNK) return rdpChunk(points, epsilonM);
  const out: GeoPoint[] = [];
  for (let s = 0; s < points.length - 1; s += RDP_CHUNK - 1) {
    const part = rdpChunk(points.slice(s, s + RDP_CHUNK), epsilonM);
    out.push(...(out.length === 0 ? part : part.slice(1)));
  }
  return out;
}

/** 반복형 Ramer–Douglas–Peucker — 끝점 유지, 출력 ⊆ 입력. */
function rdpChunk(points: readonly GeoPoint[], epsilonM: number): GeoPoint[] {
  if (points.length <= 2) return [...points];
  const project = projector(points[0]);
  const xy = points.map(project);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop() as [number, number];
    let maxD = -1;
    let idx = -1;
    for (let k = s + 1; k < e; k += 1) {
      const d = pointToSegmentM(xy[k], xy[s], xy[e]);
      if (d > maxD) {
        maxD = d;
        idx = k;
      }
    }
    if (idx !== -1 && maxD > epsilonM) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
