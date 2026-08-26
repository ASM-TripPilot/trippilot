import { useLocalSearchParams } from 'expo-router';

import { PlanbRequestPage } from '@/pages/planb-request';

/**
 * i10 재계획 요청(AI에게 맡길게요) — 얇은 라우트. 배선은 `pages/planb-request`가 진다
 * (`draft.tsx`·`manual/index.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다.
 * 수동 진입(triggerId=null) 경로 — 트리거 소비는 후속(TRIP-438).
 */
export default function PlanbRequestRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <PlanbRequestPage tripId={tripId} />;
}
