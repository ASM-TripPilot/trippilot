import { useLocalSearchParams } from 'expo-router';

import { LiveItineraryPage } from '@/pages/live-itinerary';

/** i01·i02·i03·i08 여행 중 일정 — 얇은 라우트, 배선은 `pages/live-itinerary`가 진다
 * (`itinerary/index.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. */
export default function LiveRoute() {
  const { tripId, applied } = useLocalSearchParams<{
    tripId: string;
    applied?: string;
  }>();

  return <LiveItineraryPage tripId={tripId} appliedSessionId={applied} />;
}
