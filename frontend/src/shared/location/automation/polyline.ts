import type { GeoPoint } from './routeDistance';

/**
 * Google encoded polyline (정밀도 1e-5) — 경로 업로드(§12.3)와 지도 레이어 디코드가 같이 쓴다.
 * 디코더는 점 상한을 넘으면 멈춘다(SEC-U10-07 — 자원 고갈 방지).
 */

const FACTOR = 1e5;

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(points: readonly GeoPoint[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = '';
  for (const p of points) {
    const lat = Math.round(p.lat * FACTOR);
    const lng = Math.round(p.lng * FACTOR);
    out += encodeValue(lat - lastLat) + encodeValue(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

export function decodePolyline(
  encoded: string,
  maxPoints: number = Number.POSITIVE_INFINITY
): GeoPoint[] {
  const points: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (index >= encoded.length) return null;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length && points.length < maxPoints) {
    const dLat = next();
    const dLng = next();
    if (dLat == null || dLng == null) break; // 잘린 입력 — 앞부분만
    lat += dLat;
    lng += dLng;
    points.push({ lat: lat / FACTOR, lng: lng / FACTOR });
  }
  return points;
}
