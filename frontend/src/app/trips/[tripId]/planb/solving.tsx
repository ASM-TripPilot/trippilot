import { useLocalSearchParams } from 'expo-router';

import { PlanbSolvingPage } from '@/pages/planb-draft';

/**
 * i12 재계획 로딩 — 얇은 라우트. 배선은 `pages/planb-draft`가 진다(`live/place/[poiId].tsx` 선례).
 * params 는 여기서만 읽어 prop 으로 내린다. sessionId 는 i10 제출 성공 후 쿼리로 전달될 값(후속).
 */
export default function PlanbSolvingRoute() {
  const { tripId, sessionId } = useLocalSearchParams<{
    tripId: string;
    sessionId: string;
  }>();

  return <PlanbSolvingPage tripId={tripId} sessionId={sessionId} />;
}
