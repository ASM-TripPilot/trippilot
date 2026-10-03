import { useLocalSearchParams } from 'expo-router';

import { GeneratingPage } from '@/pages/itinerary/itinerary-generating';
import type { GenerateItineraryRequestGenerationMode } from '@/shared/api/generated/schemas';

/** h09 AI 일정 생성 중 — 얇은 라우트, 배선은 `pages/itinerary/itinerary-generating`가 진다
 * (`draft.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다. 완전AI 는 h02 가 `mode=FULLY_AI` 를
 * 실어 보내고, copick 씨앗은 `mode=CO_PLAN`·`successRoute=첫 슬롯 라우트 템플릿`을 실어 보낸다
 * (TRIP-504). mode 없이 열리면(일정 탭 카드·홈 CTA 재진입) 생성을 쏘지 않는 관찰 모드다(TRIP-1006). */
export default function ItineraryGeneratingRoute() {
  const { tripId, mode, successRoute } = useLocalSearchParams<{
    tripId: string;
    mode?: GenerateItineraryRequestGenerationMode;
    successRoute?:
      | '/trips/[tripId]/itinerary/draft'
      | '/trips/[tripId]/itinerary/copick/[slotKey]';
  }>();

  return (
    <GeneratingPage tripId={tripId} mode={mode} successRoute={successRoute} />
  );
}
