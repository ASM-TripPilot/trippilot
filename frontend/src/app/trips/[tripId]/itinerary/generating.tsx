import { useLocalSearchParams } from 'expo-router';

import { GeneratingPage } from '@/pages/itinerary-generating';

/** h09 [완전AI] AI 일정 생성 중 — 얇은 라우트, 배선은 `pages/itinerary-generating`가 진다
 * (`draft.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. */
export default function ItineraryGeneratingRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <GeneratingPage tripId={tripId} />;
}
