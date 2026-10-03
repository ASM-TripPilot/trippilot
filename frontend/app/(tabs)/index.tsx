import type { ReactElement } from 'react';

import { HomePage } from '@/pages/home';

/**
 * 홈 탭 — 로직 0의 얇은 배선. 여행 조회·얼굴 판정·라우팅은 `@/pages/home`(배럴 경유)이 진다(TRIP-1142).
 */
export default function HomeRoute(): ReactElement {
  return <HomePage />;
}
