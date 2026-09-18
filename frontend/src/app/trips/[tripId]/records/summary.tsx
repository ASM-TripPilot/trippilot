import { useLocalSearchParams } from 'expo-router';

import { TripSummaryPage } from '@/pages/trip-summary';

/**
 * j04 여행 요약 · 얇은 라우트 — 배선은 `pages/trip-summary` 가 진다(`records/reflection/[date].tsx`
 * 선례). `tripId` 는 여기서만 읽어 prop 으로 내린다. `(tabs)` 밖 파일시스템 라우트라 미인증 딥링크
 * 노출 구조를 공유한다(데이터는 서버 401). 앱 내 진입 배선은 후속(딥링크·`_dev/preview.tsx` 로만 도달).
 */
export default function TripSummaryRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <TripSummaryPage tripId={tripId} />;
}
