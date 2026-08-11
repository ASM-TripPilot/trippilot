import { useLocalSearchParams } from 'expo-router';

import { ItineraryPlanPage } from '@/pages/itinerary-plan';

/** h25 완성 일정 시간표 뷰 — 얇은 라우트, 배선은 `pages/itinerary-plan`가 진다
 * (`draft.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. */
export default function ItineraryPlanRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <ItineraryPlanPage tripId={tripId} />;
}
