import type { ReactElement } from 'react';
import { useRouter, type Href } from 'expo-router';

import type { Trip } from '@/shared/api/generated/schemas';
import {
  useGetTripsTripIdBases,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { TripCard, type TripCardVM } from '@/features/settings/ui/TripCard';

/**
 * TRIP-604 · l03 여행 1건 담당 컨테이너 — 그 여행의 bases·itinerary GET 을 물어 대표정보를
 * 조립해 순수 `TripCard` 에 내린다.
 *
 * **N+1 훅-per-카드**: React 훅은 배열 루프 안에서 못 부르니(훅 규칙), 여행 하나를 담당하는 이
 * 컴포넌트를 카드 수만큼 렌더해 각자 자기 조회를 부른다(목록 1회 + 카드 N×2). h37
 * `pages/itinerary-list/TripCardContainer` 와 동형이되 **bases 축이 하나 더** 붙는다(등록 숙소 수).
 * 여행 수가 적어(실사용 2~5) 수용(Seed Q2 — 백엔드 목록 요약 필드가 생기면 제거 가능).
 *
 * 등록 숙소 수 = `bases.length`(0→"숙소 미등록") · 일정 수 = `itinerary.days.length`("일정 N일",
 * Q1 — INV-3 상 시간 아님) · 목적지 = `destinations` region 조인 · 기간 = "M.D~M.D".
 * 회고 진입은 **종료 카드에만**(status ENDED) → `/trips/{id}/records`(라우트 미존재라 `as Href`
 * 캐스트, Seed Q5 — 착지 실동작은 U5 화면 티켓 후속).
 */

export interface TripCardContainerProps {
  trip: Trip;
}

/** 'YYYY-MM-DD' → 'M.D'(앞자리 0 제거). */
function monthDay(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(month)}.${Number(day)}`;
}

const MS_PER_DAY = 86_400_000;

export function TripCardContainer({
  trip,
}: TripCardContainerProps): ReactElement {
  const router = useRouter();
  const bases = useGetTripsTripIdBases(trip.tripId);
  const itinerary = useGetTripsTripIdItinerary(trip.tripId);

  // bases 미도착(로딩·실패로 data undefined)이면 "0건"인지 알 수 없어 칩을 생략한다 — undefined 를
  // length 0 으로 접어 '숙소 미등록'을 지어내지 않는다(itinerary daysLabel 축과 대칭, INV-4).
  const basesLabel = bases.data
    ? bases.data.length === 0
      ? '숙소 미등록'
      : `숙소 ${bases.data.length}`
    : null;
  const days = itinerary.data?.days;

  // D-배지는 예정(미래 출발) 카드에만. 오늘은 라우트가 아니라 여기서 읽되(화면 파생), 종료·진행 중은
  // 배지가 없다. 종료 카드는 대신 회고 chevron 을 그린다(isEnded).
  const today = new Date().toISOString().slice(0, 10);
  const isUpcoming = trip.status === 'PLANNED' || trip.status === 'CONFIRMED';
  const daysUntil = Math.round(
    (Date.parse(trip.startDate) - Date.parse(today)) / MS_PER_DAY
  );
  const dBadge =
    isUpcoming && daysUntil >= 0
      ? daysUntil === 0
        ? 'D-DAY'
        : `D-${daysUntil}`
      : null;

  const vm: TripCardVM = {
    tripId: trip.tripId,
    destinationLabel: trip.destinations.map((d) => d.region).join(' · '),
    dateRange: `${monthDay(trip.startDate)}~${monthDay(trip.endDate)}`,
    basesLabel,
    daysLabel: days ? `일정 ${days.length}일` : null,
    dBadge,
    isEnded: trip.status === 'ENDED',
  };

  const onPressReflection = (): void => {
    router.push(`/trips/${trip.tripId}/records` as Href);
  };

  return <TripCard vm={vm} onPressReflection={onPressReflection} />;
}
