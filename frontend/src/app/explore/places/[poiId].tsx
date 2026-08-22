import { useLocalSearchParams } from 'expo-router';

import { PlaceDetailPage } from '@/pages/place-detail';

/**
 * 장소(POI) 상세 라우트 `explore/places/[poiId]` — d06 실화면 위임(TRIP-456).
 *
 * TRIP-446 스텁("준비 중")을 실화면으로 교체했다. 얇은 위임 — poiId 만 읽어 `PlaceDetailPage`
 * 에 내린다. 조회(목록 캐시 A)·저장 토글·뒤로가기 canGoBack 폴백은 전부 페이지 몫이다.
 */
export default function PlaceDetailRoute() {
  const { poiId } = useLocalSearchParams<{ poiId?: string }>();
  return <PlaceDetailPage poiId={poiId ?? ''} />;
}
