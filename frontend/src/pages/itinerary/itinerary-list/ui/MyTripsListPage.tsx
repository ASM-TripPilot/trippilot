import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';

import type { Trip } from '@/shared/api/index.schemas';
import {
  getGetTripsQueryKey,
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdItineraryQueryOptions,
  useDeleteTripsTripId,
  useGetTrips,
} from '@/shared/api/index.hooks';
import { isNotFound } from '@/shared/api';
import { isLargeText } from '@/shared/lib/fontScale';
import { seoulDate } from '@/shared/lib/seoulDate';
import { readStringValue, writeStringValue } from '@/shared/storage';
import { readDoneBarSeen, writeDoneBarSeen } from '@/entities/trip';
import { pickDoneBar, type DoneBarEntry } from '../model/doneBar';
import {
  byLatest,
  byStart,
  byTitle,
  orderMyTrips,
  parseMyTripsSortKey,
  type MyTripsSortKey,
} from '../model/myTripsOrder';
import {
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary';
import { MyTripsListScreen } from './MyTripsListScreen';
import { MyTripsSortSheet } from './MyTripsSortSheet';
import { TripDeleteDialog } from './TripDeleteDialog';
import { useTripWizardStore } from '@/features/create-trip';
import { GenerationDoneBar } from './GenerationDoneBar';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-468 · h37 "내 여행" 목록 배선 — `useGetTrips` → 최신순 정렬 → 카드마다
 * `<TripCardContainer>` 렌더, loading/error/empty 판정. `MyTripsListScreen` 에 mode·카드를 내린다.
 *
 * **이 목록이 다중 여행의 유일한 진입점**이다 — 예전엔 첫 여행(`trips.data[0]`) 하나로만
 * 리다이렉트해 둘째 이후 여행이 이 탭에서 영영 접근 불가였다(핵심 결함, AC-1). 이제 리다이렉트하지
 * 않고 모든 여행을 카드로 나열한다.
 *
 * TRIP-1615 · 조회가 실패했고 받아 둔 목록이 없으면 error 얼굴 + [다시 시도](INV-4) — 예전엔 isError 를 안 봐서 실패가
 * empty("아직 만든 여행이 없어요")로 접혔다. 데이터가 있는 재조회 실패는 목록을 그대로 둔다. 데이터 없는 오류에서
 * refetch 하면 쿼리가 pending 으로 돌아가므로 재시도 중엔 loading 얼굴이 대신한다(별도 재시도 중 상태를 두지 않는다).
 *
 * TRIP-1122 · 정렬 기준(최신순·출발일순·이름순)과 정렬 시트 열림을 페이지가 쥔다 — 시트는 열릴 때만 그린다.
 * 고른 기준은 기기에 한 줄 남기고(`itinerary.myTrips.sort`), 마운트 때 한 번 읽는다: 읽기 전엔 최신순, 오면 그
 * 기준, 읽기 실패·모르는 값은 최신순(INV-4). 사용자가 먼저 고르면 늦게 온 저장값은 무시한다. TRIP-1121 · 여행 중
 * (확정 + 오늘이 기간 안)은 어느 기준에서도 맨 위(`orderMyTrips`). 오늘을 여기서 한 번 만들어 정렬과 카드에 같은 값을 넘긴다
 * — 일정이 도착하기 전엔 판정할 수 없어, 도착하는 순간 여행 중 카드가 위로 올라간다(INV-4).
 *
 * TRIP-928 · 완료 도킹 배너 — 여행별 일정(카드 훅과 같은 캐시 키)과 기기에 저장한 "배너로 알린 여행
 * id"(seen)를 모두 읽은 뒤에만 `pickDoneBar` 로 판정한다. 처음 띄울 때 seen 을 한 번 쓰고, 그
 * 포커스 동안은 띄운 여행을 붙잡아 둔다(저장 뒤 사라지지 않게). seen 읽기 실패 = 배너 없음.
 * TRIP-1286 · 탭 화면은 탭을 옮겨도 언마운트되지 않으므로 판정·쓰기는 목록이 보일 때(포커스)만 한다 —
 * 안 보이는 동안 판정하면 본 적 없는 배너가 seen 에 들어간다. 떠나면(blur) 배너와 닫음을 함께 비우고,
 * 돌아오면 그 사이 쓴 seen 기준으로 새로 완성된 여행만 띄운다.
 * TRIP-1428 · seen 은 포커스마다 다시 읽는다 — 떠나 있는 사이 확정 훅이 더한 여행(앱에서 확정 = 토스트가 이미
 * 알림)을 따라잡는다. 떠날 때 비워 다시 읽기 전엔 판정하지 않고, 이 마운트에서 쓴 값(`seenWrittenRef`)은 다시
 * 읽은 값에 합친다 — 쓰기가 실패·대기 중이어도 이미 띄운 배너를 또 띄우지 않게.
 * 배너는 list 분기에서 화면의 형제로 붙는다 — 위젯의 `absolute bottom-[108px]` 가 탭 씬 바닥
 * 기준이 되어 BottomTab 위 12px 에 앉는다(Figma 3911:2327). TRIP-1297 · 큰 글자(`isLargeText`)에선 떠 있으면
 * 꺾인 문장만큼 목록을 덮으므로, 목록 스크롤 맨 위(`listHeader`)에 일반 흐름 카드로 놓는다(Figma 근거 없음).
 */

/** SecureStore 키 규칙(영숫자·`.`·`-`·`_`) · 토큰 키와 다른 이름. */
const SORT_KEY = 'itinerary.myTrips.sort';

export function MyTripsListPage(): ReactElement {
  const router = useRouter();
  const trips = useGetTrips();
  const list = trips.data ?? [];

  // 새 훅은 전부 아래 일찍 return 들보다 위(훅 호출 순서 규칙).
  // TRIP-1618 · 생성 중 일정의 폴링은 이 페이지가 아니라 앱 셸(`useGenerationWatch`)이 한다 — 아래 `useQueries` 는 그 칸을
  // 읽기만 한다(셸이 같은 캐시 칸을 갱신하면 카드·배너가 저절로 바뀐다). 예전엔 여기서 2초 간격으로 물었다(TRIP-1271) —
  // 탭 화면은 내려가지 않아 다시 물을 계기가 없었기 때문이고, TRIP-1614 가 보일 때만 묻도록 줄였다.
  // `focused` 는 폴링이 아니라 완료 배너 판정(TRIP-1286)이 계속 쓴다 — 목록이 보이는 동안만 판정, 첫 렌더는 안 보임으로 시작해
  // 포커스 effect 가 켠다.
  const [focused, setFocused] = useState(false);
  const itineraries = useQueries({
    queries: list.map((trip) =>
      getGetTripsTripIdItineraryQueryOptions(trip.tripId)
    ),
  });
  const [seen, setSeen] = useState<readonly string[] | null>(null);
  const [shown, setShown] = useState<Trip | null>(null);
  // TRIP-1241 — 닫음. shown 을 비우면 seen state 가 옛 값이라 pick 이 다시 계산돼 재표시되므로 별도 플래그로 든다.
  const [barDismissed, setBarDismissed] = useState(false);
  // TRIP-1428 — 이 마운트에서 seen 에 쓴(쓰려 한) 값. 다시 읽은 값에 합친다.
  const seenWrittenRef = useRef<readonly string[]>([]);
  const largeText = isLargeText(useWindowDimensions().fontScale);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      // 실패하면 seen 이 null 로 남아 배너가 안 뜬다(닫힌 쪽 실패). 떠난 뒤 도착한 읽기는 버린다.
      let active = true;
      readDoneBarSeen().then(
        (ids) => {
          if (active) {
            setSeen([...new Set([...ids, ...seenWrittenRef.current])]);
          }
        },
        () => {}
      );
      return () => {
        active = false;
        setFocused(false);
        setSeen(null);
        setShown(null);
        setBarDismissed(false);
      };
    }, [])
  );

  // TRIP-1055 · 삭제 — 대상·실패 표시·요청을 페이지가 쥔다(다이얼로그는 카드·스크롤 밖 형제).
  const queryClient = useQueryClient();

  // TRIP-1271 · 탭 복귀 재조회 — 폴링하지 않는 여행이 다른 화면에서 바뀐 것을 따라잡는다(일정 키만). 첫
  // 포커스(=첫 마운트)는 첫 조회가 이미 나가 있으므로 건너뛴다. 콜백 정체가 바뀌면 다시 불리므로 고정한다.
  const focusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedRef.current) {
        focusedRef.current = true;
        return;
      }
      const cached =
        queryClient.getQueryData<Trip[]>(getGetTripsQueryKey()) ?? [];
      // 낡은 것만 다시 묻는다(TRIP-1348) — 방금 받은 일정까지 N건 무조건 재요청하던 것을 줄인다.
      // type 'active' 는 종전 invalidate 의 범위(관찰자가 있는 쿼리)를 지킨다 — 기본값 'all' 이면
      // 지금 안 보는 쿼리까지 새로 받는다.
      cached.forEach((trip) =>
        queryClient.refetchQueries({
          queryKey: getGetTripsTripIdItineraryQueryKey(trip.tripId),
          type: 'active',
          stale: true,
        })
      );
    }, [queryClient])
  );
  const deleteTrip = useDeleteTripsTripId();
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // 실패한 요청의 tripId — 대기 중 취소 뒤 다른 카드를 열면 앞 결과가 새 다이얼로그에 안 떨어지게 id 로 든다.
  const [deleteFailedId, setDeleteFailedId] = useState<string | null>(null);
  // 연타 잠금은 ref — isPending 은 늦게 알려져 같은 틱 두 번째 press 를 못 막는다(02a ★2).
  const deletingRef = useRef(false);

  // TRIP-1122 · 정렬 — 사용자가 한 번 고르면 뒤늦게 도착한 저장값이 그 선택을 덮지 않게 ref 로 표시한다.
  const [sortKey, setSortKey] = useState<MyTripsSortKey>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  // 정렬 시트가 열려 있는 동안 하단 탭바를 숨긴다(TRIP-1240) — 탭바는 탭 레이아웃이 그리는 absolute 오버레이라
  // 씬 안의 시트 아래쪽('이름순')을 가렸다. 탭 레이아웃 어댑터가 이 옵션을 읽어 탭바를 안 그린다. 닫히거나
  // 화면이 사라지면 되돌린다(`tabBarStyle: undefined` — 탭 레이아웃은 display 가 'none' 일 때만 숨기므로 이 값이면 보인다).
  // TRIP-1508 — 삭제 확인창이 떠 있는 동안도 같다: 딤이 탭바를 못 덮어 탭바가 밝게 남고 눌리기까지 했다.
  const { setOptions } = useNavigation();
  const hideTabBar = sortOpen || deleteTargetId !== null;
  useEffect(() => {
    if (!hideTabBar) return undefined;
    setOptions({ tabBarStyle: { display: 'none' } });
    return () => setOptions({ tabBarStyle: undefined });
  }, [hideTabBar, setOptions]);
  const sortPickedRef = useRef(false);

  useEffect(() => {
    // 읽기 실패는 최신순 그대로(INV-4 — 목록은 이미 최신순으로 서 있다).
    readStringValue(SORT_KEY).then(
      (raw) => {
        if (!sortPickedRef.current) setSortKey(parseMyTripsSortKey(raw));
      },
      () => {}
    );
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
    shown || !focused || seen === null || trips.isPending
      ? null
      : pickDoneBar(entries, seen);

  useEffect(() => {
    if (!pick) return;
    setShown(pick.target);
    // 쓴 값을 상태(이 포커스)와 ref(다음 포커스의 다시 읽기)에 둔다 — 옛 seen 으로 판정하면 같은 여행을 또 띄운다.
    setSeen(pick.seenNext);
    seenWrittenRef.current = pick.seenNext;
    writeDoneBarSeen(pick.seenNext).catch(() => {});
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

  if (trips.isError && !trips.data) {
    return (
      <MyTripsListScreen
        mode="error"
        onPressCreateTrip={onPressCreateTrip}
        onRetry={() => {
          trips.refetch();
        }}
      />
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
    today,
    sortKey === 'start'
      ? byStart(today)
      : sortKey === 'title'
        ? byTitle
        : byLatest
  );

  const onSelectSort = (key: MyTripsSortKey): void => {
    sortPickedRef.current = true;
    setSortKey(key);
    setSortOpen(false);
    // 저장 실패는 삼킨다 — 이번 마운트의 화면은 고른 대로 남는다(doneBar 쓰기와 같은 선례).
    writeStringValue(SORT_KEY, key).catch(() => {});
  };

  const onConfirmDelete = (): void => {
    if (deleteTargetId === null || deletingRef.current) return;
    deletingRef.current = true;
    setDeleteFailedId(null);
    const tripId = deleteTargetId;
    // 목록은 항상 다시 받고(지워진 건 사실), 다이얼로그는 보낸 여행의 것일 때만 닫는다.
    const done = (): void => {
      setDeleteTargetId((current) => (current === tripId ? null : current));
      // TRIP-1441 — 완료 배너가 지운 여행을 가리키면 내린다(확정 여행에도 ⋯ 가 열려 도달 가능해졌다).
      // 함수형 갱신 — 응답이 늦게 와도 그 시점의 shown 이 지운 여행일 때만 비운다. 닫힘 플래그(barDismissed)는
      // 건드리지 않는다: 지운 여행은 seen 에 이미 있어 다시 안 뜨고, 플래그를 세우면 새로 고른 다른 여행의
      // 배너까지 삼킨다(5-b 경고-1).
      setShown((current) => (current?.tripId === tripId ? null : current));
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

  const doneBar =
    doneTrip && !barDismissed ? (
      <GenerationDoneBar
        tripName={doneTrip.title}
        onPressView={onPressView}
        onPressClose={() => setBarDismissed(true)}
        inline={largeText}
      />
    ) : null;

  return (
    <View className="flex-1">
      <MyTripsListScreen
        mode="list"
        onPressCreateTrip={onPressCreateTrip}
        sortKey={sortKey}
        onPressSort={() => setSortOpen(true)}
        listHeader={largeText ? doneBar : undefined}
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
      {largeText ? null : doneBar}
      {deleteTargetId !== null ? (
        <TripDeleteDialog
          failed={deleteFailedId === deleteTargetId}
          confirmed={
            itineraries[list.findIndex((t) => t.tripId === deleteTargetId)]
              ?.data?.status === 'CONFIRMED'
          }
          onCancel={() => setDeleteTargetId(null)}
          onConfirm={onConfirmDelete}
        />
      ) : null}
      {sortOpen ? (
        <MyTripsSortSheet
          selected={sortKey}
          onSelect={onSelectSort}
          onClose={() => setSortOpen(false)}
        />
      ) : null}
    </View>
  );
}
