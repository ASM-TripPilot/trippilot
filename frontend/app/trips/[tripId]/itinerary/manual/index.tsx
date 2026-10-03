import { useLocalSearchParams } from 'expo-router';

import { ManualPlanPage } from '@/pages/itinerary/itinerary-manual';

/** h19 직접 짜기(빈 일정) — 얇은 라우트, 배선은 `pages/itinerary/itinerary-manual`가 진다(`draft.tsx` 선례).
 * params 는 여기서만 읽어 prop 으로 내린다. 마운트 POST(생성)·조회는 페이지 몫. `fresh=1` 은 초안의
 * 비우기 확인 「비우고 시작」이 싣는 신호다(TRIP-1038 C · `must-visits` 의 `mode` 선례). */
export default function ManualPlanRoute() {
  const { tripId, fresh } = useLocalSearchParams<{
    tripId: string;
    fresh?: string;
  }>();

  return <ManualPlanPage tripId={tripId} startFresh={fresh === '1'} />;
}
