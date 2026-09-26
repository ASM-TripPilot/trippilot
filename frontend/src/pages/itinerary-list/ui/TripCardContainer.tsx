import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import type { Trip } from '@/shared/api/generated/schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import { formatNightsLabel } from '@/entities/trip/lib/formatNights';
import { formatConfirmedDateRange } from '@/entities/trip/lib/formatTripPeriod';
import {
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary/model/planState';
import { deriveTripCardFace } from '@/features/itinerary/model/tripCardFace';
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
 * 얼굴 파생(TRIP-788 · TRIP-986): pending(미도착)·404 아닌 조회 실패→배지 미정 degrade · 그 외는
 * `deriveTripCardFace`(순수)가 상태문·배지·resume 를 함께 낸다(일정 없음/생성중/완성/초안, Mapping A).
 * 목적지: `resolveItineraryDestination`(확정만 live) → `itineraryDestinationHref`. 두 규칙을 홈 카드
 * CTA·일정 탭이 공유한다. 구 "오늘이 여행 구간이면 무조건 live" 특례는 미확정 초안까지 live 로 보내
 * 지워졌다(TRIP-986 D3).
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

  // 미도착·404 아닌 조회 실패("모른다")면 배지·상태문·resume 전부 없는 degrade — 실패를 "일정 없음"
  // 으로 말하지 않는다(INV-4). 그 외(404 = "없다" 포함)는 얼굴을 순수 함수가 낸다(seam 포함).
  const notFound = isNotFound(itinerary.error);
  let badge: MyTripBadge;
  let extra: string | null;
  let resume: boolean;
  if (itinerary.isPending || (itinerary.isError && !notFound)) {
    badge = null;
    extra = null;
    resume = false;
  } else {
    const face = deriveTripCardFace(
      itinerary.data?.status,
      itinerary.data?.generationState,
      notFound
    );
    badge = face.badge;
    extra = face.statusLine;
    resume = face.resume;
  }

  const vm: MyTripCardVM = {
    tripId: trip.tripId,
    title: trip.title,
    metaLine: `${formatCardDateRange(trip.startDate, trip.endDate)} · ${formatNightsLabel(trip.startDate, trip.endDate)} · ${trip.party}명`,
    badge,
    extra,
    resume,
  };

  const onPress = (): void => {
    router.push(
      itineraryDestinationHref(
        trip.tripId,
        resolveItineraryDestination({
          notFound,
          generationState: itinerary.data?.generationState,
          status: itinerary.data?.status,
        })
      )
    );
  };

  return <MyTripCard vm={vm} onPress={onPress} />;
}
