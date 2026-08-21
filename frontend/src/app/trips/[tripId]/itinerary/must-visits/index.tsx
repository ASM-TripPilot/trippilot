import { useLocalSearchParams } from 'expo-router';

import { MustVisitListPage } from '@/pages/itinerary-mustvisit';
import type { GenerateItineraryRequestGenerationMode } from '@/shared/api/generated/schemas';

/** h05 필수 방문지 (선택) — 얇은 라우트, 배선은 `pages/itinerary-mustvisit`가 진다
 * (`trips/new/step1.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. 완전AI 는 mode 없이
 * 들어와 기존 동작, copick 씨앗은 `mode=CO_PLAN` 을 실어 보낸다(TRIP-504 · generating.tsx 선례). */
export default function MustVisitListRoute() {
  const { tripId, mode } = useLocalSearchParams<{
    tripId: string;
    mode?: GenerateItineraryRequestGenerationMode;
  }>();

  return <MustVisitListPage tripId={tripId} mode={mode} />;
}
