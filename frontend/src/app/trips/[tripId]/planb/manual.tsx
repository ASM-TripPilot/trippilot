import { useLocalSearchParams } from 'expo-router';

import { PlanbManualPage } from '@/pages/planb-manual';

/**
 * TRIP-443 · i15·i22 수동 편집 — 얇은 라우트, 배선은 `pages/planb-manual`이 진다
 * (`live/location.tsx`·`planb/solving.tsx` 선례). params(tripId·variant)만 읽어 prop 으로 내린다 —
 * `variant` 를 흘려야 폴백 진입(error=i22)과 정상 [직접 고르기] 진입(미지정=i15)이 갈린다
 * (진입 신호 겹침을 라우트 파라미터로 가름).
 */
export default function PlanbManualRoute() {
  const { tripId, variant } = useLocalSearchParams<{
    tripId: string;
    variant?: 'error' | 'normal';
  }>();

  return <PlanbManualPage tripId={tripId} variant={variant} />;
}
