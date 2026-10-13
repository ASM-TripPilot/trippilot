import { useEffect, useState } from 'react';

import { isLocationAutomationEnabled } from './flag';
import { getAutomationSink, type RouteDay } from './sink';

/**
 * TRIP-1342 · `GET /trips/{tripId}/routes`(§12.3 초안) 소비 — 지금은 가짜 싱크가 답한다. BE 개통 시 싱크 교체만.
 * 플래그 OFF 면 요청하지 않는다(빈 목록). Query 캐시를 쓰지 않는다 — 플래그 OFF 화면(QueryClient 없는 목 테스트 포함)에
 * 새 의존을 만들지 않으려고. BE 개통 때 orval 쿼리 훅으로 바꾼다.
 */
export function useTripRoutes(tripId: string | null | undefined): {
  routes: RouteDay[];
  isLoading: boolean;
} {
  const enabled = isLocationAutomationEnabled() && Boolean(tripId);
  const [state, setState] = useState<{
    key: string | null;
    routes: RouteDay[];
  }>({
    key: null,
    routes: [],
  });

  useEffect(() => {
    if (!enabled || !tripId) return undefined;
    let alive = true;
    getAutomationSink()
      .fetchRoutes(tripId)
      .then((routes) => {
        if (alive) setState({ key: tripId, routes });
      })
      .catch(() => {
        // 조회 실패 = 경로 없음으로 보인다(실제 칸 비활성 + 사유) — 화면을 막지 않는다(INV-4).
        if (alive) setState({ key: tripId, routes: [] });
      });
    return () => {
      alive = false;
    };
  }, [enabled, tripId]);

  if (!enabled) return { routes: [], isLoading: false };
  return {
    routes: state.key === tripId ? state.routes : [],
    isLoading: state.key !== tripId,
  };
}
