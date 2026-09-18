import { useLocalSearchParams } from 'expo-router';

import { LivePlacePage } from '@/pages/live-place';

/** i05 여행 중 현재 장소 상세 — 얇은 라우트, 배선은 `pages/live-place`가 진다
 * (`live/index.tsx` 선례). params(tripId·poiId) 는 여기서만 읽어 prop 으로 내린다. */
export default function LivePlaceRoute() {
  const { tripId, poiId } = useLocalSearchParams<{
    tripId: string;
    poiId: string;
  }>();

  return <LivePlacePage tripId={tripId} poiId={poiId} />;
}
