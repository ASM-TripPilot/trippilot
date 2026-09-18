import { useLocalSearchParams } from 'expo-router';

import { PlanbDiffPage } from '@/pages/planb-diff';

/**
 * i18/i19 재계획 확정 — 얇은 라우트. 배선은 `pages/planb-diff`가 진다(`planb/solving.tsx` 선례).
 * params 는 여기서만 읽어 prop 으로 내린다. sessionId 는 i18 진입 시 쿼리로 전달될 값(진입
 * 배선은 후속 — 지금은 딥링크·프리뷰 도달만 전제한다).
 */
export default function PlanbDiffRoute() {
  const { tripId, sessionId } = useLocalSearchParams<{
    tripId: string;
    sessionId: string;
  }>();

  return <PlanbDiffPage tripId={tripId} sessionId={sessionId} />;
}
