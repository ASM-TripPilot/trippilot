import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import type { Trip } from '@/shared/api/generated/schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import {
  formatConfirmedDateRange,
  formatNightsLabel,
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary/model/planState';
import {
  MyTripCard,
  type MyTripBadge,
  type MyTripCardVM,
} from '@/features/itinerary/ui/MyTripCard';

/**
 * TRIP-468 · 여행 1건 담당 컨테이너 — 그 여행의 `useGetTripsTripIdItinerary` 를 물어
 * VM(배지·부가정보·목적지)을 조립해 순수 `MyTripCard` 에 내린다.
 *
 * **N+1 훅-per-카드**: React 훅은 배열 루프 안에서 못 부르니(훅 규칙), 여행 하나를 담당하는 이
 * 컴포넌트를 카드 수만큼 렌더해 각자 자기 훅을 부른다(목록 1회 + 카드 N회). 여행 수가 적고(실사용
 * 2~5) 병렬·react-query 캐시라 수용(01b Q2 — 백엔드 목록 요약 필드가 생기면 제거 가능).
 *
 * 배지 파생: pending(미도착)→null · itinerary CONFIRMED→done · 그 외→draft.
 * 목적지: 오늘이 여행 구간이면 live(US-ONTRIP-01), 아니면 `resolveItineraryDestination`(티켓 지정
 * 재사용) → `itineraryDestinationHref`. 두 규칙을 홈 카드 CTA·일정 탭이 공유한다.
 */

export interface TripCardContainerProps {
  trip: Trip;
}

/** 날짜범위 `~` 조립 — 공용 `formatConfirmedDateRange`(en-dash `–`, h25 확정 배너 공용)는 미수정하고
 * 구분자만 Figma h37 의 `~` 로 로컬 치환한다(01b Q5, h25 회귀 회피). */
function formatCardDateRange(startDate: string, endDate: string): string {
  return formatConfirmedDateRange(startDate, endDate).replace(' – ', ' ~ ');
}

export function TripCardContainer({
  trip,
}: TripCardContainerProps): ReactElement {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(trip.tripId);

  const badge: MyTripBadge = itinerary.isPending
    ? null
    : itinerary.data?.status === 'CONFIRMED'
      ? 'done'
      : 'draft';

  const extra: string | null =
    badge === 'done'
      ? `확정 장소 ${(itinerary.data?.days ?? []).flatMap((day) => day.slots).length}곳`
      : badge === 'draft'
        ? '추천안 준비 중'
        : null;

  const vm: MyTripCardVM = {
    tripId: trip.tripId,
    title: trip.title,
    metaLine: `${formatCardDateRange(trip.startDate, trip.endDate)} · ${formatNightsLabel(trip.startDate, trip.endDate)} · ${trip.party}명`,
    badge,
    extra,
  };

  const today = new Date().toISOString().slice(0, 10);
  const todayInTrip = trip.startDate <= today && today <= trip.endDate;

  const onPress = (): void => {
    if (todayInTrip) {
      router.push(`/trips/${trip.tripId}/live`);
      return;
    }
    router.push(
      itineraryDestinationHref(
        trip.tripId,
        resolveItineraryDestination({
          notFound: isNotFound(itinerary.error),
          generationState: itinerary.data?.generationState,
          status: itinerary.data?.status,
        })
      )
    );
  };

  return <MyTripCard vm={vm} onPress={onPress} />;
}
