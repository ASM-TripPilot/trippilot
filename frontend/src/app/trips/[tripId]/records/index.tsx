import { useLocalSearchParams } from 'expo-router';

import { TripRecordsPage } from '@/pages/trip-records';

/**
 * j01 방문 기록 · default — 얇은 라우트, 배선은 `pages/trip-records` 가 진다(`live/index.tsx`
 * 선례). params 는 여기서만 읽어 prop 으로 내린다. 탭 셸 교체 전이라 딥링크/캘린더(j07) 경유로
 * 도달한다(브리프 맹점4).
 */
export default function RecordsRoute() {
  const { tripId, day } = useLocalSearchParams<{
    tripId: string;
    day?: string;
  }>();

  return <TripRecordsPage tripId={tripId} day={day} />;
}
