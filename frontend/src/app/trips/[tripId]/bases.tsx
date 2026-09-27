import { useLocalSearchParams } from 'expo-router';

import { TripBasesPage } from '@/pages/trip-new-step2';

/** 여행 단위 거점 화면(TRIP-1011 C) — 얇은 라우트, 배선은 `pages/trip-new-step2`가 진다
 * (`itinerary/method.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. */
export default function TripBasesRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <TripBasesPage tripId={tripId} />;
}
