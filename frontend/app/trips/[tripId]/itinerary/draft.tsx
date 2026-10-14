import { useLocalSearchParams } from 'expo-router';

import { DraftPage } from '@/pages/itinerary/itinerary-draft';

/** h11 [완전AI] AI 추천안 초안 — 얇은 라우트, 배선은 `pages/itinerary/itinerary-draft`가 진다
 * (`must-visits/index.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. `reveal=1` 은 생성 화면이
 * 막 성공해 넘길 때만 싣는다(TRIP-1385) — 목록·카드·재진입 경로는 싣지 않는다. */
export default function ItineraryDraftRoute() {
  const { tripId, reveal } = useLocalSearchParams<{
    tripId: string;
    reveal?: string;
  }>();

  return <DraftPage tripId={tripId} reveal={reveal === '1'} />;
}
