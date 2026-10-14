import type { QueryClient } from '@tanstack/react-query';

import { getGetTripsQueryOptions } from '@/shared/api/index.hooks';

/**
 * 홈이 첫 렌더에 쓰는 `GET /trips` 를 /bootstrap 과 나란히 미리 받아 캐시에 둔다(TRIP-1362) — 홈 1 RTT 절감.
 * 키는 홈의 `useGetTrips()` 와 같아야 한다(둘 다 `getGetTripsQueryOptions()` 기본 키). 실패는 조용히 삼킨다:
 * 미리 받기는 최적화일 뿐이라 홈의 일반 조회가 그대로 다시 묻는다. 재시도는 끈다 — 부팅 중 네트워크가 나쁠 때
 * 홈 조회와 겹쳐 요청이 불어나지 않게(INV-4 와 무관한 최적화 경로).
 */
export function prefetchTrips(client: QueryClient): void {
  void client.prefetchQuery({ ...getGetTripsQueryOptions(), retry: false });
}
