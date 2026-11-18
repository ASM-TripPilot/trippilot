import type { QueryClient } from '@tanstack/react-query';

import { getGetTripsQueryOptions } from '@/shared/api/index.trips';

/**
 * 홈이 첫 렌더에 쓰는 `GET /trips` 를 /bootstrap 과 나란히 미리 받아 캐시에 둔다(TRIP-1362) — 홈 1 RTT 절감.
 * 키는 홈의 `useGetTrips()` 와 같아야 한다(둘 다 `getGetTripsQueryOptions()` 기본 키). 실패는 조용히 삼킨다:
 * 미리 받기는 최적화일 뿐이라 홈의 일반 조회가 그대로 다시 묻는다. 재시도는 끈다 — 부팅 중 네트워크가 나쁠 때
 * 홈 조회와 겹쳐 요청이 불어나지 않게(INV-4 와 무관한 최적화 경로).
 *
 * TRIP-1719 측정(Release 시뮬·dev-api, 쪽당 10회 A·B·A·B, `pnpm bench:startup --until homeTrips`) — 유지 근거:
 * 켜면 스플래시가 걷힐 때 홈 여행 데이터가 이미 있고, 끄면 걷힌 뒤 p50 175ms(p90 197) 동안 스켈레톤을 본다
 * (JS 진입→홈 데이터 p50: 켬 1402 / 끔 1588ms). 대신 켜면 /bootstrap 확정이 p50 약 67ms 늦게 측정됐다(두 요청이 같이 나가서로
 * 추정 — 원인은 안 쟀다). 첫 실행은 SplashGate SPLASH_MIN_VISIBLE_MS 하한이 그 지연을 흡수하지만, TRIP-1831 부터 재방문은 하한이 없어
 * 그 지연이 콜드 합계에 그대로 얹힌다(재방문 쪽은 다시 잰다).
 */
export function prefetchTrips(client: QueryClient): void {
  void client.prefetchQuery({ ...getGetTripsQueryOptions(), retry: false });
}
