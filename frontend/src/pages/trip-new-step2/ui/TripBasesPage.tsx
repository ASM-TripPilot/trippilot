import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';

import { BaseNightsFlow } from './TripNewStep2Page';

/**
 * TRIP-1011 C — 여행 단위 거점 화면(`/trips/[tripId]/bases`, 3/4 "거점 숙소 다시 고르기"로 push).
 * 위저드 스토어가 아니라 서버 여행(`GET /trips/{tripId}`)의 기간·여행지로 2/4 와 같은 공통 배선을
 * 부른다 — 3/4 로는 일정 탭 카드로도 들어오므로 스토어엔 다른 여행 값이 남아 있을 수 있다.
 *
 * 두 CTA 는 3/4 로 돌아간다(push 로 왔으면 back, 딥링크면 replace). tripId 가 늘 있어 notrip 얼굴은
 * 안 나오지만 화면 prop 이 필수라 "처음부터"에도 같은 복귀를 넘긴다(빈 핸들러 금지).
 */
export function TripBasesPage({ tripId }: { tripId: string }): ReactElement {
  const router = useRouter();
  const trip = useGetTripsTripId(tripId);

  function backToMethod(): void {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({
      pathname: '/trips/[tripId]/itinerary/method',
      params: { tripId },
    });
  }

  return (
    <BaseNightsFlow
      tripId={tripId}
      startDate={trip.data?.startDate}
      endDate={trip.data?.endDate}
      destinations={trip.data?.destinations ?? []}
      onExit={backToMethod}
      onBack={backToMethod}
      onRestart={backToMethod}
      tripLoad={trip}
    />
  );
}
