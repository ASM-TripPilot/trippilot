import { useEffect, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';

import type { Trip } from '@/shared/api/generated/schemas';
import {
  getGetTripsTripIdItineraryQueryOptions,
  useGetTrips,
} from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import { readIdSet, writeIdSet } from '@/shared/storage/idSet';
import { pickDoneBar } from '@/features/itinerary/model/doneBar';
import {
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary/model/planState';
import { MyTripsListScreen } from '@/features/itinerary/ui/MyTripsListScreen';
import { GenerationDoneBar } from '@/widgets/generation-done-bar/ui/GenerationDoneBar';

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
 *
 * TRIP-928 · 완료 도킹 배너 — 여행별 일정(카드 훅과 같은 캐시 키)과 기기에 저장한 "배너로 알린 여행
 * id"(seen)를 모두 읽은 뒤에만 `pickDoneBar` 로 판정한다. 처음 띄울 때 seen 을 한 번 쓰고, 그
 * 마운트 동안은 띄운 여행을 붙잡아 둔다(저장 뒤 사라지지 않게). seen 읽기 실패 = 배너 없음.
 * 배너는 list 분기에서 화면의 형제로 붙는다 — 위젯의 `absolute bottom-[108px]` 가 탭 씬 바닥
 * 기준이 되어 BottomTab 위 12px 에 앉는다(Figma 3911:2327).
 */

/** SecureStore 키 규칙(영숫자·`.`·`-`·`_`) · 토큰 키와 다른 이름. */
const DONE_BAR_SEEN_KEY = 'itinerary.doneBar.seen';

/** 최신순 정렬 키 — 갱신 시각이 없으면 생성 시각으로 접는다(계약상 updatedAt 은 항상 있으나 방어). */
function sortKey(trip: Trip): string {
  return trip.updatedAt ?? trip.createdAt;
}

export function MyTripsListPage(): ReactElement {
  const router = useRouter();
  const trips = useGetTrips();
  const list = trips.data ?? [];

  // 새 훅은 전부 아래 일찍 return 들보다 위(훅 호출 순서 규칙).
  const itineraries = useQueries({
    queries: list.map((trip) =>
      getGetTripsTripIdItineraryQueryOptions(trip.tripId)
    ),
  });
  const [seen, setSeen] = useState<readonly string[] | null>(null);
  const [shown, setShown] = useState<Trip | null>(null);

  useEffect(() => {
    // 실패하면 seen 이 null 로 남아 배너가 안 뜬다(닫힌 쪽 실패).
    readIdSet(DONE_BAR_SEEN_KEY).then(setSeen, () => {});
  }, []);

  const pick =
    shown || seen === null || trips.isPending
      ? null
      : pickDoneBar(
          list.map((trip, i) => ({
            trip,
            itinerary: itineraries[i].isPending
              ? 'pending'
              : {
                  status: itineraries[i].data?.status,
                  generationState: itineraries[i].data?.generationState,
                },
          })),
          seen
        );

  useEffect(() => {
    if (!pick) return;
    setShown(pick.target);
    writeIdSet(DONE_BAR_SEEN_KEY, pick.seenNext).catch(() => {});
  }, [pick]);

  const onPressCreateTrip = (): void => router.push('/trips/new/step1');

  if (trips.isPending) {
    return (
      <MyTripsListScreen mode="loading" onPressCreateTrip={onPressCreateTrip} />
    );
  }

  if (list.length === 0) {
    return (
      <MyTripsListScreen mode="empty" onPressCreateTrip={onPressCreateTrip} />
    );
  }

  const sorted = [...list].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const doneTrip = shown ?? pick?.target;

  const onPressView = (): void => {
    if (!doneTrip) return;
    const query =
      itineraries[list.findIndex((t) => t.tripId === doneTrip.tripId)];
    router.push(
      itineraryDestinationHref(
        doneTrip.tripId,
        resolveItineraryDestination({
          notFound: isNotFound(query?.error),
          generationState: query?.data?.generationState,
          status: query?.data?.status,
        })
      )
    );
  };

  return (
    <View className="flex-1">
      <MyTripsListScreen
        mode="list"
        onPressCreateTrip={onPressCreateTrip}
        cards={sorted.map((trip) => (
          <TripCardContainer key={trip.tripId} trip={trip} />
        ))}
      />
      {doneTrip ? (
        <GenerationDoneBar
          tripName={doneTrip.title}
          onPressView={onPressView}
        />
      ) : null}
    </View>
  );
}
