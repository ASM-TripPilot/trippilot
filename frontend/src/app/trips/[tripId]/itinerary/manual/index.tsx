import { useLocalSearchParams } from 'expo-router';

import { ManualPlanPage } from '@/pages/itinerary-manual';

/** h19 직접 짜기(빈 일정) — 얇은 라우트, 배선은 `pages/itinerary-manual`가 진다(`draft.tsx` 선례).
 * params 는 여기서만 읽어 prop 으로 내린다. 마운트 POST(생성)·조회는 페이지 몫. */
export default function ManualPlanRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <ManualPlanPage tripId={tripId} />;
}
