import { useLocalSearchParams } from 'expo-router';

import { MustVisitTimePage } from '@/pages/itinerary-mustvisit';

/** h07 방문 시각 지정 — 얇은 라우트. `[poiId]` 는 `MustVisit.sourcePoiId` 다(01b D11 — 셀렉터와
 * 라우트 파라미터가 같은 값이라 두 벌을 들고 다니지 않는다). */
export default function MustVisitTimeRoute() {
  const { tripId, poiId } = useLocalSearchParams<{
    tripId: string;
    poiId: string;
  }>();

  return <MustVisitTimePage tripId={tripId} sourcePoiId={poiId} />;
}
