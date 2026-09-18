import { useLocalSearchParams } from 'expo-router';

import { SlotFillPage } from '@/pages/itinerary-copick';

/** h13 컨셉 → h14/h15 슬롯 채우기 — 얇은 라우트, 배선은 `pages/itinerary-copick`가 진다.
 * params(tripId·slotKey)는 여기서만 읽어 prop 으로 내린다. */
export default function CoPickSlotFillRoute() {
  const { tripId, slotKey } = useLocalSearchParams<{
    tripId: string;
    slotKey: string;
  }>();

  return <SlotFillPage tripId={tripId} slotKey={slotKey} />;
}
