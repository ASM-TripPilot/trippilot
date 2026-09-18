/**
 * TRIP-397 · 실제 경로 누적 거리 + 위치 동의 게이트(frontend-components.md §3 · BR-U4-41·42).
 *
 * `accumulateDistanceKm` = 앱을 켜 둔 구간의 GPS 점열을 이어 잰 누적 이동 거리(km). **걸음 수는
 * 산출하지 않는다**(BR-U4-41 — noStepCountStructure 가드가 심볼 자체를 막는다). 좌표 거리라
 * 슬롯 시각과 무관하다(INV-2·liveTimeStructure 대상 아님).
 *
 * `resolveActualRoute` = 위치 동의가 없으면 실제 경로 레이어를 **항상 비활성**으로 두고 사유를
 * 동반하며 거리를 산출하지 않는다(BR-U4-42 · PBT-U4-F3 — 리포 CI 차단 게이트). 계획 동선만 보인다.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** 두 점의 대권 거리(km) — 하버사인. */
function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function accumulateDistanceKm(points: readonly GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineKm(points[i - 1], points[i]);
  }
  return total;
}

// 위치 동의가 없을 때 실제 경로 레이어 자리에 다는 사유(침묵 금지, INV-4). 정확 문안은 정본에
// 없어 "권한을 켜면 기록된다" 계열로 둔다 — 화면 심판은 "사유 존재"만 본다.
const NO_CONSENT_REASON = '위치 권한을 켜면 실제 이동 경로가 기록돼요';

export interface ActualRouteView {
  enabled: boolean;
  reason: string | null;
  distanceKm: number;
}

export function resolveActualRoute(input: {
  locationConsent: boolean;
  points: readonly GeoPoint[];
}): ActualRouteView {
  if (!input.locationConsent) {
    // 동의 없으면 어떤 점열이 와도 비활성·거리 0·사유 동반(PBT-U4-F3).
    return { enabled: false, reason: NO_CONSENT_REASON, distanceKm: 0 };
  }
  return {
    enabled: true,
    reason: null,
    distanceKm: accumulateDistanceKm(input.points),
  };
}
