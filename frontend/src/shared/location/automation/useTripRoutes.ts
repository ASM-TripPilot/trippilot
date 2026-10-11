import { useQuery } from '@tanstack/react-query';

import { isLocationAutomationEnabled } from './flag';
import { getAutomationSink, type RouteDay } from './sink';

/**
 * TRIP-1342 · `GET /trips/{tripId}/routes`(§12.3 초안) 소비 — 지금은 가짜 싱크가 답한다. BE 개통 시 싱크 교체만.
 * 플래그 OFF 면 요청하지 않는다(빈 목록).
 */
export function useTripRoutes(tripId: string | null | undefined): {
  routes: RouteDay[];
  isLoading: boolean;
} {
  const enabled = isLocationAutomationEnabled() && Boolean(tripId);
  const query = useQuery({
    queryKey: ['u10', 'routes', tripId],
    queryFn: () => getAutomationSink().fetchRoutes(tripId as string),
    enabled,
  });
  return {
    routes: enabled ? (query.data ?? []) : [],
    isLoading: enabled && query.isLoading,
  };
}
