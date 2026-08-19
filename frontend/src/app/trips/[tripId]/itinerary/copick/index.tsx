import { useLocalSearchParams } from 'expo-router';

import { CoPickHubPage } from '@/pages/itinerary-copick';

/** h16 같이 고르기 허브(진입) — 얇은 라우트, 배선은 `pages/itinerary-copick`가 진다
 * (`draft.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. */
export default function CoPickHubRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <CoPickHubPage tripId={tripId} />;
}
