import { useLocalSearchParams } from 'expo-router';

import { RecordsComparePage } from '@/pages/records-compare';

/**
 * j02 기록 비교 · 얇은 라우트 — 배선은 `pages/records-compare` 가 진다(`records/summary.tsx`(j04)
 * 미러). `tripId` 는 여기서만 읽어 prop 으로 내린다. `(tabs)` 밖 파일시스템 라우트라 미인증 딥링크
 * 노출 구조를 공유한다(데이터는 서버 401). 앱 내 진입 배선은 후속(딥링크·`_dev/preview.tsx` 로만 도달).
 */
export default function RecordsCompareRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <RecordsComparePage tripId={tripId} />;
}
