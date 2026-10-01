import { useLocalSearchParams } from 'expo-router';

import { ItineraryEditPage } from '@/pages/itinerary-edit';

/**
 * i07 일정 편집(TRIP-753) — 얇은 라우트. 여행 중 [직접 수정] 진입은 h12 편집 페이지를 그대로 쓰고,
 * 이 주소로 왔다는 사실(라우트가 곧 진입 신호)만 `inTrip` 으로 넘긴다.
 */
export default function PlanbManualRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <ItineraryEditPage tripId={tripId} inTrip />;
}
