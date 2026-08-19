import { useLocalSearchParams } from 'expo-router';

import { CoPickCompletePage } from '@/pages/itinerary-copick';

/** h17 내가 고른 완성 — 얇은 라우트, 배선은 `pages/itinerary-copick`가 진다.
 * params 는 여기서만 읽어 prop 으로 내린다. */
export default function CoPickCompleteRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <CoPickCompletePage tripId={tripId} />;
}
