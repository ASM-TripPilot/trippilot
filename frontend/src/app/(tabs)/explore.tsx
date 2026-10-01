import type { ReactElement } from 'react';

import { ExploreLandingPage } from '@/pages/explore-landing';

/**
 * 탐색 탭 — 로직 0의 얇은 배선. d01 조회·지역 필터(`region` 파라미터)·담기 배선은
 * `@/pages/explore-landing`(배럴 경유)이 진다(TRIP-1142).
 */
export default function ExploreRoute(): ReactElement {
  return <ExploreLandingPage />;
}
