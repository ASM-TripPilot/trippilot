import { useLocalSearchParams } from 'expo-router';

import {
  LiveLocationPage,
  type LiveLocationState,
} from '@/pages/live-location';

/** i20·i21 위치 수동 입력·권한 거부 폴백 — 얇은 라우트, 배선은 `pages/live-location`이 진다
 * (`live/place/[poiId].tsx` 선례). params(tripId·state)만 읽어 prop 으로 내린다 — `state` 를
 * 흘려야 딥링크/프리뷰가 `?state=` 로 i20/i21 얼굴을 고른다(Seed: 진입 배선 딥링크·프리뷰 전용). */
export default function LiveLocationRoute() {
  const { tripId, state } = useLocalSearchParams<{
    tripId: string;
    state: LiveLocationState;
  }>();

  return <LiveLocationPage tripId={tripId} state={state} />;
}
