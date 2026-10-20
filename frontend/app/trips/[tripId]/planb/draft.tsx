import { useLocalSearchParams } from 'expo-router';

import { PlanbDraftPage } from '@/pages/live/planb-draft';

/**
 * i13/i16 재계획안 — 얇은 라우트. 배선은 `pages/live/planb-draft`가 진다(`solving.tsx` 선례 동형).
 * params 는 여기서만 읽어 prop 으로 내린다.
 */
export default function PlanbDraftRoute() {
  // 상황 감지 FE-B — 넣으려던 POI(기회 카드 → i04)를 i06 미포함 안내까지 잇는다(서버엔 안 보낸다).
  const { tripId, sessionId, includePoiId } = useLocalSearchParams<{
    tripId: string;
    sessionId: string;
    includePoiId?: string;
  }>();

  return (
    <PlanbDraftPage
      tripId={tripId}
      sessionId={sessionId}
      includePoiId={includePoiId}
    />
  );
}
