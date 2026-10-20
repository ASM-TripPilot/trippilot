import { useLocalSearchParams } from 'expo-router';

import { PlanbSolvingPage } from '@/pages/live/planb-draft';

/**
 * i12 재계획 로딩 — 얇은 라우트. 배선은 `pages/live/planb-draft`가 진다(`live/place/[poiId].tsx` 선례).
 * params 는 여기서만 읽어 prop 으로 내린다. sessionId 는 i10 제출 성공 후 쿼리로 전달될 값(후속).
 */
export default function PlanbSolvingRoute() {
  // 상황 감지 FE-B — 넣으려던 POI(기회 카드 → i04)를 i06 미포함 안내까지 잇는다(서버엔 안 보낸다).
  const { tripId, sessionId, includePoiId } = useLocalSearchParams<{
    tripId: string;
    sessionId: string;
    includePoiId?: string;
  }>();

  return (
    <PlanbSolvingPage
      tripId={tripId}
      sessionId={sessionId}
      includePoiId={includePoiId}
    />
  );
}
