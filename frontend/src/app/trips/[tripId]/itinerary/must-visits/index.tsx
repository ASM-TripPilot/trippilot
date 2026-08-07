import { useLocalSearchParams } from 'expo-router';

import { MustVisitListPage } from '@/pages/itinerary-mustvisit';

/** h05 필수 방문지 (선택) — 얇은 라우트, 배선은 `pages/itinerary-mustvisit`가 진다
 * (`trips/new/step1.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. */
export default function MustVisitListRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <MustVisitListPage tripId={tripId} />;
}
