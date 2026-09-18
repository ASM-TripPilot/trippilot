import { useLocalSearchParams } from 'expo-router';

import { PlanbDraftPage } from '@/pages/planb-draft';

/**
 * i13/i16 재계획안 — 얇은 라우트. 배선은 `pages/planb-draft`가 진다(`solving.tsx` 선례 동형).
 * params 는 여기서만 읽어 prop 으로 내린다.
 */
export default function PlanbDraftRoute() {
  const { tripId, sessionId } = useLocalSearchParams<{
    tripId: string;
    sessionId: string;
  }>();

  return <PlanbDraftPage tripId={tripId} sessionId={sessionId} />;
}
