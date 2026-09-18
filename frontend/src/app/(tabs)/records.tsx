import type { ReactElement } from 'react';

import { RecordsCalendarPage } from '@/pages/records-calendar';

/**
 * 기록 탭 — j07 여행 캘린더 허브(TRIP-575). "기록 준비 중" 자리표시자(TRIP-290)를 교체했다.
 * 조회·조립·항법은 전부 `RecordsCalendarPage`(pages 층)가 지고, 이 라우트는 얇은 배선만 한다
 * (다른 탭 라우트 관례 동형 — 로직 0).
 */
export default function RecordsScreen(): ReactElement {
  return <RecordsCalendarPage />;
}
