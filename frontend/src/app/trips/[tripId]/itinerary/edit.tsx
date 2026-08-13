import { useLocalSearchParams } from 'expo-router';

import { ItineraryEditPage } from '@/pages/itinerary-edit';

/** h24 일정 편집 화면 — 얇은 라우트, 배선은 `pages/itinerary-edit`가 진다(`itinerary/index.tsx`
 * 선례). params 는 여기서만 읽어 prop 으로 내린다. */
export default function ItineraryEditRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <ItineraryEditPage tripId={tripId} />;
}
