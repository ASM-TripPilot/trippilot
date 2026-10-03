import { useLocalSearchParams } from 'expo-router';

import { RecordAddVisitPage } from '@/pages/record/record-add-visit';

/** j01 [방문 추가] 장소 피커 — 얇은 라우트, 배선은 `pages/record/record-add-visit` 가 진다. params 는 여기서만
 * 읽어 prop 으로 내린다. `day` 는 j01 활성 일자 — 두 화면이 같은 (tripId, day) 방문 캐시를 본다. */
export default function AddVisitRoute() {
  const { tripId, day } = useLocalSearchParams<{
    tripId: string;
    day: string;
  }>();

  return <RecordAddVisitPage tripId={tripId} day={day} />;
}
