import { useLocalSearchParams } from 'expo-router';

import { ItineraryHistoryPage } from '@/pages/itinerary/itinerary-history';

/** h36 일정 변경 이력 — 얇은 라우트, 배선은 `pages/itinerary/itinerary-history`가 진다(`edit.tsx` 선례). */
export default function ItineraryHistoryRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <ItineraryHistoryPage tripId={tripId} />;
}
