import { AUTOMATION_CONFIG } from './config';
import { decodePolyline } from './polyline';
import type { RouteDay } from './sink';

/**
 * TRIP-1342 · 서버 RouteDay → 지도 실제 경로 세그먼트(`MapView actualRoute`). 세그먼트 경계를 보존한다(공백 안 잇기).
 * 하루 총 점 상한을 넘으면 디코드를 멈춘다(SEC-U10-07). 시각·속도는 다루지 않는다(INV-3).
 */
export function routeDayToSegments(
  route: Pick<RouteDay, 'segments'>,
  maxPoints: number = AUTOMATION_CONFIG.route.maxPoints
): { lat: number; lng: number }[][] {
  const out: { lat: number; lng: number }[][] = [];
  let budget = maxPoints;
  for (const encoded of route.segments) {
    if (budget <= 0) break;
    const points = decodePolyline(encoded, budget);
    if (points.length < 2) continue;
    budget -= points.length;
    out.push(points);
  }
  return out;
}

export function routeDayForDate(
  routes: readonly RouteDay[],
  date: string
): RouteDay | null {
  return routes.find((r) => r.date === date) ?? null;
}
