import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import type { Trip } from '@/shared/api/generated/schemas';
import { useGetTrips } from '@/shared/api/generated/trips/trips';
import { MyTripsListScreen } from '@/features/itinerary/ui/MyTripsListScreen';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-468 · h37 "내 여행" 목록 배선 — `useGetTrips` → 최신순 정렬 → 카드마다
 * `<TripCardContainer>` 렌더, empty/loading 판정. `MyTripsListScreen` 에 mode·카드를 내린다.
 *
 * **이 목록이 다중 여행의 유일한 진입점**이다 — 예전엔 첫 여행(`trips.data[0]`) 하나로만
 * 리다이렉트해 둘째 이후 여행이 이 탭에서 영영 접근 불가였다(핵심 결함, AC-1). 이제 리다이렉트하지
 * 않고 모든 여행을 카드로 나열한다.
 *
 * 정렬은 `updatedAt` 내림차순(없으면 `createdAt`) — "최신순" 표시 라벨과 짝(01b Q1).
 */

/** 최신순 정렬 키 — 갱신 시각이 없으면 생성 시각으로 접는다(계약상 updatedAt 은 항상 있으나 방어). */
function sortKey(trip: Trip): string {
  return trip.updatedAt ?? trip.createdAt;
}

export function MyTripsListPage(): ReactElement {
  const router = useRouter();
  const trips = useGetTrips();

  const onPressCreateTrip = (): void => router.push('/trips/new/step1');

  if (trips.isPending) {
    return (
      <MyTripsListScreen mode="loading" onPressCreateTrip={onPressCreateTrip} />
    );
  }

  const list = trips.data ?? [];
  if (list.length === 0) {
    return (
      <MyTripsListScreen mode="empty" onPressCreateTrip={onPressCreateTrip} />
    );
  }

  const sorted = [...list].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

  return (
    <MyTripsListScreen
      mode="list"
      onPressCreateTrip={onPressCreateTrip}
      cards={sorted.map((trip) => (
        <TripCardContainer key={trip.tripId} trip={trip} />
      ))}
    />
  );
}
