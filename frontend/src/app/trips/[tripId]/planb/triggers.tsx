import { useLocalSearchParams } from 'expo-router';

import { PlanbTriggersPage } from '@/pages/planb-triggers';

/**
 * TRIP-562 · i09 감시 항목 열람 — 얇은 라우트, 배선은 `pages/planb-triggers` 가 진다
 * (`planb/solving.tsx`·`planb/diff.tsx` 선례). `tripId` 만 읽어 prop 으로 내린다. 라이브 화면 진입
 * FAB(`execution-live-watchlist-fab`)가 `router.push('/trips/{tripId}/planb/triggers')` 로 이 라우트를 연다.
 */
export default function PlanbTriggersRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();

  return <PlanbTriggersPage tripId={tripId} />;
}
