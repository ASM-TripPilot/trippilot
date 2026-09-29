import { useEffect, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';

import type { Trip } from '@/shared/api/generated/schemas';
import {
  getGetTripsQueryKey,
  getGetTripsTripIdItineraryQueryOptions,
  useDeleteTripsTripId,
  useGetTrips,
} from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import { seoulDate } from '@/shared/date/seoulDate';
import { readIdSet, writeIdSet } from '@/shared/storage/idSet';
import {
  pickDoneBar,
  type DoneBarEntry,
} from '@/features/itinerary/model/doneBar';
import { orderMyTrips } from '@/features/itinerary/model/myTripsOrder';
import {
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary/model/planState';
import { MyTripsListScreen } from '@/features/itinerary/ui/MyTripsListScreen';
import { TripDeleteDialog } from '@/features/itinerary/ui/TripDeleteDialog';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
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
 * 정렬은 `updatedAt` 내림차순(없으면 `createdAt`) — "최신순" 표시 라벨과 짝(01b Q1). TRIP-1121 · 여행 중
 * (확정 + 오늘이 기간 안)은 맨 위(`orderMyTrips`). 오늘을 여기서 한 번 만들어 정렬과 카드에 같은 값을 넘긴다
 * — 일정이 도착하기 전엔 판정할 수 없어, 도착하는 순간 여행 중 카드가 위로 올라간다(INV-4).
 *
 * TRIP-928 · 완료 도킹 배너 — 여행별 일정(카드 훅과 같은 캐시 키)과 기기에 저장한 "배너로 알린 여행
 * id"(seen)를 모두 읽은 뒤에만 `pickDoneBar` 로 판정한다. 처음 띄울 때 seen 을 한 번 쓰고, 그
 * 마운트 동안은 띄운 여행을 붙잡아 둔다(저장 뒤 사라지지 않게). seen 읽기 실패 = 배너 없음.
 * 배너는 list 분기에서 화면의 형제로 붙는다 — 위젯의 `absolute bottom-[108px]` 가 탭 씬 바닥
 * 기준이 되어 BottomTab 위 12px 에 앉는다(Figma 3911:2327).
 */

/** SecureStore 키 규칙(영숫자·`.`·`-`·`_`) · 토큰 키와 다른 이름. */
const DONE_BAR_SEEN_KEY = 'itinerary.doneBar.seen';

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

  // TRIP-1055 · 삭제 — 대상·실패 표시·요청을 페이지가 쥔다(다이얼로그는 카드·스크롤 밖 형제).
  const queryClient = useQueryClient();
  const deleteTrip = useDeleteTripsTripId();
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // 실패한 요청의 tripId — 대기 중 취소 뒤 다른 카드를 열면 앞 결과가 새 다이얼로그에 안 떨어지게 id 로 든다.
  const [deleteFailedId, setDeleteFailedId] = useState<string | null>(null);
  // 연타 잠금은 ref — isPending 은 늦게 알려져 같은 틱 두 번째 press 를 못 막는다(02a ★2).
  const deletingRef = useRef(false);

  useEffect(() => {
    // 실패하면 seen 이 null 로 남아 배너가 안 뜬다(닫힌 쪽 실패).
    readIdSet(DONE_BAR_SEEN_KEY).then(setSeen, () => {});
  }, []);

  // 여행별 일정 응답(카드 훅과 같은 캐시 키) — 완료 배너와 여행 중 고정이 같이 읽는다.
  const entries: DoneBarEntry[] = list.map((trip, i) => ({
    trip,
    itinerary: itineraries[i].isPending
      ? 'pending'
      : {
          status: itineraries[i].data?.status,
          generationState: itineraries[i].data?.generationState,
        },
  }));
  const today = seoulDate(new Date());

  const pick =
    shown || seen === null || trips.isPending
      ? null
      : pickDoneBar(entries, seen);

  useEffect(() => {
    if (!pick) return;
    setShown(pick.target);
    writeIdSet(DONE_BAR_SEEN_KEY, pick.seenNext).catch(() => {});
  }, [pick]);

  // 새 여행 진입 — 직전 드래프트를 이동 전에 비운다(TRIP-1012 #074).
  const onPressCreateTrip = (): void => {
    useTripWizardStore.getState().reset();
    router.push('/trips/new/step1');
  };

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

  // 정렬만 404 아닌 조회 실패(다시 받기 실패로 직전 data 가 남은 경우 포함)를 "모름"으로 접는다 — 카드의
  // degrade(배지 없음)와 같은 해석이라 배지 없는 카드가 고정되지 않는다(D3). 배너 입력(entries)은 그대로.
  const sorted = orderMyTrips(
    entries.map((entry, i) =>
      itineraries[i].isError && !isNotFound(itineraries[i].error)
        ? { trip: entry.trip, itinerary: 'pending' as const }
        : entry
    ),
    today
  );

  const onConfirmDelete = (): void => {
    if (deleteTargetId === null || deletingRef.current) return;
    deletingRef.current = true;
    setDeleteFailedId(null);
    const tripId = deleteTargetId;
    // 목록은 항상 다시 받고(지워진 건 사실), 다이얼로그는 보낸 여행의 것일 때만 닫는다.
    const done = (): void => {
      setDeleteTargetId((current) => (current === tripId ? null : current));
      queryClient.invalidateQueries({ queryKey: getGetTripsQueryKey() });
    };
    deleteTrip.mutate(
      { tripId },
      {
        onSuccess: done,
        // 404 = 이미 없다(다른 기기에서 지움 등) → 성공처럼 목록만 다시 받는다(01b Q5).
        // 500·네트워크는 다이얼로그 안에 알리고 카드를 남긴다(INV-4).
        onError: (error) =>
          isNotFound(error) ? done() : setDeleteFailedId(tripId),
        onSettled: () => {
          deletingRef.current = false;
        },
      }
    );
  };
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
          generationMode: query?.data?.generationMode,
        }),
        query?.data?.days
      )
    );
  };

  return (
    <View className="flex-1">
      <MyTripsListScreen
        mode="list"
        onPressCreateTrip={onPressCreateTrip}
        cards={sorted.map((trip) => (
          <TripCardContainer
            key={trip.tripId}
            trip={trip}
            today={today}
            onPressDelete={() => {
              setDeleteFailedId(null);
              setDeleteTargetId(trip.tripId);
            }}
          />
        ))}
      />
      {doneTrip ? (
        <GenerationDoneBar
          tripName={doneTrip.title}
          onPressView={onPressView}
        />
      ) : null}
      {deleteTargetId !== null ? (
        <TripDeleteDialog
          failed={deleteFailedId === deleteTargetId}
          onCancel={() => setDeleteTargetId(null)}
          onConfirm={onConfirmDelete}
        />
      ) : null}
    </View>
  );
}
