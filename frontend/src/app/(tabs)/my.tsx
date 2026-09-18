import type { ReactElement } from 'react';

import { MyPage } from '@/pages/my-page';

/**
 * 마이 탭 — TRIP-290 "마이 준비 중" StateNotice 셸을 l03 실화면으로 교체(TRIP-604).
 * 로직 0의 얇은 배선 — 조회·분류·조합은 `@/pages/my-page`(배럴 경유)가 진다.
 */
export default function MyScreen(): ReactElement {
  return <MyPage />;
}
