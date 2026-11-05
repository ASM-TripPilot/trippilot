import { useLocalSearchParams } from 'expo-router';

import { TripAlbumPage } from '@/pages/record/trip-album';

/**
 * 여행 앨범(TRIP-1798) · 얇은 라우트 — 배선은 `pages/record/trip-album` 이 진다(`records/summary.tsx` 선례).
 * 하단 바가 없는 화면이라 SplashGate 의 `BAR_SCREEN_ROUTES`·`NO_SWIPE_ROUTES` 에는 넣지 않는다(기본 슬라이드·스와이프 뒤로).
 * 딥링크 `trippilot://trips/<tripId>/records/album` 이 자동으로 생긴다(데이터는 서버 401 이 막는다).
 */
export default function TripAlbumRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <TripAlbumPage tripId={tripId} />;
}
