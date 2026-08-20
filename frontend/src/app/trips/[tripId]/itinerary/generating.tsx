import { useLocalSearchParams } from 'expo-router';

import { GeneratingPage } from '@/pages/itinerary-generating';
import type { GenerateItineraryRequestGenerationMode } from '@/shared/api/generated/schemas';

/** h09 AI 일정 생성 중 — 얇은 라우트, 배선은 `pages/itinerary-generating`가 진다
 * (`draft.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. 완전AI 는 mode·successRoute 없이
 * 들어와 기본값(FULLY_AI·draft)을 쓰고, copick 씨앗은 `mode=CO_PLAN`·`successRoute=copick 허브`를
 * 실어 보낸다(TRIP-462). */
export default function ItineraryGeneratingRoute() {
  const { tripId, mode, successRoute } = useLocalSearchParams<{
    tripId: string;
    mode?: GenerateItineraryRequestGenerationMode;
    successRoute?:
      '/trips/[tripId]/itinerary/draft' | '/trips/[tripId]/itinerary/copick';
  }>();

  return (
    <GeneratingPage tripId={tripId} mode={mode} successRoute={successRoute} />
  );
}
