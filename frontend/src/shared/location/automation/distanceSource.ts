import type { RouteDay } from './sink';

export type DistanceSource = 'ROUTE' | 'VISIT_LINE';

/**
 * TRIP-1343 · 거리 출처 날짜 단위(BR-U10-39). 경로(세그먼트 ≥1)가 있는 날 ROUTE, 없는 날 VISIT_LINE(근사).
 * 요약 전체는 모든 날이 ROUTE 일 때만 ROUTE. 서버 DayHighlight.distanceSource(§12.5) 개통 전 FE 파생값이다.
 */
export function distanceSourceByDate(
  dates: readonly string[],
  routes: readonly RouteDay[]
): { byDate: Record<string, DistanceSource>; overall: DistanceSource } {
  const has = new Set(
    routes.filter((r) => r.segments.length > 0).map((r) => r.date)
  );
  const byDate: Record<string, DistanceSource> = {};
  for (const d of dates) byDate[d] = has.has(d) ? 'ROUTE' : 'VISIT_LINE';
  const overall: DistanceSource =
    dates.length > 0 && dates.every((d) => byDate[d] === 'ROUTE')
      ? 'ROUTE'
      : 'VISIT_LINE';
  return { byDate, overall };
}
