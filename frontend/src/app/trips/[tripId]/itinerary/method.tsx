import { useLocalSearchParams } from 'expo-router';

import { ItineraryMethodPage } from '@/pages/itinerary-method';

/** h04 시작 방법(3방식) — 얇은 라우트, 배선은 `pages/itinerary-method`가 진다
 * (`draft.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. */
export default function ItineraryMethodRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <ItineraryMethodPage tripId={tripId} />;
}
