import { useLocalSearchParams } from 'expo-router';

import { DraftPage } from '@/pages/itinerary-draft';

/** h11 [완전AI] AI 추천안 초안 — 얇은 라우트, 배선은 `pages/itinerary-draft`가 진다
 * (`must-visits/index.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. */
export default function ItineraryDraftRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <DraftPage tripId={tripId} />;
}
