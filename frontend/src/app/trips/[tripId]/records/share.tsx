import { useLocalSearchParams } from 'expo-router';

import { ShareCardPage } from '@/pages/share-card';

/**
 * j06 공유 카드 · 얇은 라우트 — 배선은 `pages/share-card` 가 진다(`records/summary.tsx` 선례).
 * `tripId` 는 여기서만 읽어 prop 으로 내린다. `(tabs)` 밖 파일시스템 라우트라 미인증 딥링크 노출 구조를
 * 공유한다(데이터는 서버 401). j04·j03 진입점에서 push 로 도달 · BottomTab 없음(전체화면).
 */
export default function ShareCardRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <ShareCardPage tripId={tripId} />;
}
