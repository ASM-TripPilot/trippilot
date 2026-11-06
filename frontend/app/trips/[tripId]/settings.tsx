import { useLocalSearchParams } from 'expo-router';

import { TripSettingsPage } from '@/pages/trip/trip-settings';

/** 여행 설정 화면(TRIP-1787) — 얇은 라우트, 배선은 `pages/trip/trip-settings`가 진다. 내 여행 카드 ⋯ 「여행 설정」(TRIP-1786)이
 * 여기로 push 한다. 주소에서 `tripId` 만 읽어 내린다. */
export default function TripSettingsRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <TripSettingsPage tripId={tripId} />;
}
