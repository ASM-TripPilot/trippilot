import { useLocalSearchParams } from 'expo-router';

import { PlaceAddPage } from '@/pages/itinerary-manual';

/** h20 장소 추가·검색 — 얇은 라우트, 배선은 `pages/itinerary-manual`가 진다(`draft.tsx` 선례).
 * params 는 여기서만 읽어 prop 으로 내린다. 검색·추가 저장은 페이지 몫. */
export default function PlaceAddRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <PlaceAddPage tripId={tripId} />;
}
