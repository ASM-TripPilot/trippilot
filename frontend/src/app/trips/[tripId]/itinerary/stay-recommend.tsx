import { useLocalSearchParams } from 'expo-router';

import { StayRecommendPage } from '@/pages/itinerary-stay-recommend';

/** h15 동선 기준 숙소 추천 — 얇은 라우트, 배선은 `pages/itinerary-stay-recommend`가 진다. 추천 데이터는
 * 넘기지 않는다(실 추천 API 미배선 — 페이지가 정직한 안내 얼굴로 떨어진다). */
export default function StayRecommendRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <StayRecommendPage tripId={tripId} />;
}
