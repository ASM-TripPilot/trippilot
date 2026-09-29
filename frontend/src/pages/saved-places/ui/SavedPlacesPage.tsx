/**
 * d02 담은 장소 배선(TRIP-223 · US-EXPL-04 · US-SHELL-05 · BR-U1-04·06·09·37). 목록 조회·정렬·
 * 해제·게스트 판정·로딩 실패 얼굴을 여기서 모은다 — 화면(`SavedPlaceListScreen`)은 결과만
 * 그린다(props만).
 *
 * **TRIP-494: d02 는 장소만 그린다(Figma 정본 1693:1183 — topBar+장소 list+ctaBar, 숙소 섹션
 * 없음).** TRIP-449 가 얹었던 숙소(SavedStay) 축은 여기서 뺐다 — 저장한 숙소는 별도 화면
 * e04(`/stays/saved`, SavedStayPage)가 진다(정본 2화면 분리). 화면(`SavedPlaceListScreen`)의
 * 숙소 옵셔널 prop 은 미전달로 두면 섹션이 안 그려져 남겨 둔다(무회귀 additive 역).
 *
 * **TRIP-394로 해제 동작이 뒤집혔다** — 하트를 눌러도 행이 사라지지 않고 **자리에 남아 빈 하트**가
 * 되고, 빈 하트를 다시 누르면 같은 자리에서 되돌린다(재담김). 서버는 실제로 해제/재담김되고,
 * 실패하면 배너 + 하트 원복(INV-4). 그래서 페이지가 방문 범위 상태 둘을 소유한다:
 * `releasedPoiIds`(빈 하트인 poiId)와 `snapshots`(원본 보존). `mergeReleasedSnapshots`가
 * `useSavedPlaces`의 서버 목록과 스냅숏을 합쳐 정렬(01b Seed Q1·Q2·Q3)하고, 조회 상태
 * (`isPending`·`isError`)를 `resolvePlaceListState`에 태워 얼굴을 정한다(d04와 같은 판정 함수
 * 재사용 — hasQuery·hasCategory는 늘 false라 filter-zero는 구조적으로 도달 불가).
 * **게스트 분기(`isGuest`)는 이 판정과 별개로 화면에 그대로 내려간다** — `enabled: isAuthed`인
 * 쿼리는 게스트에게 `isPending`이 영원히 true라(★1), 화면이 게스트를 상태 판정보다 먼저 봐야
 * 끝나지 않는 로딩을 피한다.
 *
 * 실패는 `REMOVE_FAILURE_NOTICE`(해제)·`SAVE_FAILURE_NOTICE`(되돌리기)로 배너를 세운다(INV-4).
 * 배너는 타이머 없이 다음 조작에서 지운다(01b Seed Q9) — 매 조작 시작에서 `removeError`를 비운다.
 */
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import type { SavedPlace } from '@/shared/api/generated/schemas';
import {
  getGetTripsTripIdMustVisitsQueryKey,
  postTripsTripIdMustVisits,
  useGetTripsTripId,
  useGetTripsTripIdMustVisits,
} from '@/shared/api/generated/trips/trips';
import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import { getAccessToken } from '@/shared/api/tokenManager';

import { filterSavedPlacesByTripRegions } from '@/features/explore/model/filterSavedPlacesByTripRegions';
import {
  resolvePlaceListState,
  type PlaceListState,
} from '@/features/explore/model/placeListState';
import { useRegions } from '@/features/explore/model/regions';
import {
  REMOVE_FAILURE_NOTICE,
  SAVE_FAILURE_NOTICE,
  type PlaceSaveNotice,
} from '@/features/explore/model/placeSaveGuard';
import { orderSavedPlaces } from '@/features/explore/model/savedPlaceList';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { wizardOriginParams } from '@/features/explore/model/wizardOrigin';
import { MustVisitOutsideConfirmDialog } from '@/features/explore/ui/MustVisitOutsideConfirmDialog';
import { MustVisitPickScreen } from '@/features/explore/ui/MustVisitPickScreen';
import { SavedPlaceListScreen } from '@/features/explore/ui/SavedPlaceListScreen';
import { buildAnytimeMustVisitRequest } from '@/features/itinerary/model/mustVisitTimeForm';
import {
  mustVisitFailureNotice,
  seedMustVisits,
} from '@/features/trip/model/mustVisitSeed';
import {
  placeLocationLabel,
  regionCodeInTrip,
  sidoKey,
} from '@/features/trip/model/regionMatch';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

/** 실패 시 재시도가 다시 밟아야 할 마지막 조작 — 해제냐 되돌리기냐를 함께 기억한다. */
type LastAttempt = { saved: SavedPlace; mode: 'release' | 'restore' };

/**
 * 방문 범위 병합 — 서버 목록과 이번 방문에 해제한 스냅숏을 하나로 세운다(TRIP-394). 되돌리기
 * (재담김) 응답이 **더 늦은 savedAt**을 줘도 스냅숏의 원 정렬 키로 덮어써 위치를 지키고(같은
 * 자리 복귀, 02a ★3), 서버 목록에서 빠진 해제 항목은 스냅숏을 다시 끼워 넣어 빈 하트로 살린다.
 */
function buildDisplayList(
  serverPlaces: SavedPlace[],
  releasedPoiIds: Set<string>,
  snapshots: Map<string, SavedPlace>
): SavedPlace[] {
  const overridden = serverPlaces.map((entry) => {
    const snap = snapshots.get(entry.place.poiId);
    return snap
      ? { ...entry, savedPlaceId: snap.savedPlaceId, savedAt: snap.savedAt }
      : entry;
  });
  const presentPoiIds = new Set(overridden.map((entry) => entry.place.poiId));
  const orphanedReleased = [...releasedPoiIds]
    .filter((poiId) => !presentPoiIds.has(poiId))
    .map((poiId) => snapshots.get(poiId))
    .filter((entry): entry is SavedPlace => entry !== undefined);

  return orderSavedPlaces([...overridden, ...orphanedReleased]);
}

/**
 * select 모드(TRIP-706) — 담기/해제 대신 '꼭 갈 곳 고르기'. 화면은 별 파일(props-only)이고, 이
 * 하위 컴포넌트가 선택 집합을 소유해 완료 시 **선택분만** 넘긴다(D2 · AC-1 TRIP-491 재현 봉합).
 * select-empty 얼굴은 진짜로 담은 곳이 0일 때만 뜬다(save 모드의 RegionEmptyBlock 은 select 에 없다).
 *
 * 지역 판정·표기는 여기 한 벌이고, **여행 지역·초기 선택·완료는 감싸개가 준다**(TRIP-1093 S1-A) —
 * 위저드 모드(`WizardMustVisitPick`, 드래프트)와 여행 모드(`TripMustVisitPick`, 서버). 판정을 복제하면
 * 한쪽만 고쳐지는 드리프트가 생긴다.
 */
function MustVisitPickSection({
  state,
  orderedList,
  onRetry,
  destinations,
  initialSelectedPoiIds,
  lockedPoiIds = [],
  completeError,
  onToggle,
  onComplete,
}: {
  state: PlaceListState;
  orderedList: SavedPlace[];
  onRetry: () => void;
  /** 여행 지역 — 판정 키는 `regionCode`, 표시·d04 파라미터는 `region` 이름. */
  destinations: readonly { region: string; regionCode?: string | null }[];
  /** 마운트 때 한 번 읽는 초기 선택. */
  initialSelectedPoiIds: () => string[];
  /** 이미 등록돼 체크된 채 잠긴 곳(여행 모드). */
  lockedPoiIds?: string[];
  completeError?: string | null;
  /** 체크 토글마다 — 여행 모드가 실패 배너를 걷는다(타이머 없이 다음 조작에서, 01b Q3). */
  onToggle?: () => void;
  /** 고른 poiId 전부와 고를 수 있는 행(지역 안)·밖 행을 넘긴다 — 무엇을 보낼지는 감싸개가 정한다. */
  onComplete: (
    selectedPoiIds: string[],
    insideList: SavedPlace[],
    outsideList: SavedPlace[]
  ) => void;
}): ReactElement {
  const [selectedPoiIds, setSelectedPoiIds] = useState<string[]>(
    initialSelectedPoiIds
  );
  // 행 위치의 시도 짧은 이름은 서버 카탈로그에서 얻는다(상수표 없음, TRIP-445).
  const catalog = useRegions().data;

  // 지역 판정은 코드 접두사(TRIP-1042 · BR-U1-58 · INV-U1-21). 밖은 숨기지 않고 "이 여행 지역 밖 N곳"
  // 머리글 아래 흐리게 그리되 고를 수 없다(INV-4). 지역 안이 0건이어도 전체로 되돌리지 않는다.
  const destinationCodes = destinations.map((d) => d.regionCode);
  const insideList = orderedList.filter((saved) =>
    regionCodeInTrip(saved.place.regionCode, destinationCodes)
  );
  const outsideRegionPlaces = orderedList.filter(
    (saved) => !insideList.includes(saved)
  );
  // 같은 지역을 두 번 담아도(스토어 허용) 한 번만 — 첫 등장 순서 유지(03b 참고-2).
  const destinationNames = [...new Set(destinations.map((d) => d.region))];
  const regionEmptyLabel =
    insideList.length === 0 && outsideRegionPlaces.length > 0
      ? destinationNames.map(sidoKey).join('·')
      : undefined;
  const locationLabels = Object.fromEntries(
    orderedList.flatMap((saved) => {
      const label = placeLocationLabel(saved.place, catalog ?? []);
      return label ? [[saved.place.poiId, label]] : [];
    })
  );
  // 선택 수·완료 활성은 **보이는 체크**만 센다 — 안 보이는 선택이 "N곳 선택됨"에 남으면 시드와 어긋난다
  // (TRIP-982 A8 · TRIP-1042 AC-11). 잠긴(이미 등록) 곳은 채워진 체크로 보이므로 함께 센다(01b Q2).
  // 밖 행은 잠기지 않은 선택만 체크로 보이고 센다(TRIP-1106 결정 0 · Q1 — 여행 모드의 등록된 밖 곳은 무변경).
  const hasRow = (list: SavedPlace[], id: string): boolean =>
    list.some((saved) => saved.place.poiId === id);
  const visibleSelectedPoiIds = [
    ...new Set([...selectedPoiIds, ...lockedPoiIds]),
  ].filter(
    (id) =>
      hasRow(insideList, id) ||
      (hasRow(outsideRegionPlaces, id) && !lockedPoiIds.includes(id))
  );
  // d04 로 가는 세 버튼은 여행 지역 **이름**을 싣는다(TRIP-1042 AC-7 — d04 는 이름을 받는다). 목적지가
  // 없으면 region 키를 싣지 않는다. 위저드 출처는 d04 가 ＋(새 여행 = reset)를 숨기는 신호다(TRIP-1026).
  const exploreHref = {
    pathname: '/explore/places',
    params:
      destinationNames.length > 0
        ? { region: destinationNames, ...wizardOriginParams() }
        : wizardOriginParams(),
  } as const;
  return (
    <MustVisitPickScreen
      state={state}
      savedPlaces={insideList}
      outsideRegionPlaces={outsideRegionPlaces}
      regionEmptyLabel={regionEmptyLabel}
      locationLabels={locationLabels}
      selectedPoiIds={visibleSelectedPoiIds}
      lockedPoiIds={lockedPoiIds}
      completeError={completeError}
      onToggleSelect={(poiId) => {
        onToggle?.();
        setSelectedPoiIds((prev) =>
          prev.includes(poiId)
            ? prev.filter((id) => id !== poiId)
            : [...prev, poiId]
        );
      }}
      onComplete={() =>
        onComplete(selectedPoiIds, insideList, outsideRegionPlaces)
      }
      onPressAddMore={() => router.push(exploreHref)}
      onRetry={onRetry}
      onPressBrowse={() => router.push(exploreHref)}
      onBack={() => router.back()}
    />
  );
}

type PickWrapperProps = {
  state: PlaceListState;
  orderedList: SavedPlace[];
  onRetry: () => void;
};

/** 위저드 모드 — 여행 지역·초기 선택은 위저드 드래프트, 완료는 드래프트 시드 후 1/4 로. */
type WizardCompletion = {
  selectedPoiIds: string[];
  insideList: SavedPlace[];
  /** 선택된 채 남은 밖 행 poiId — 다이얼로그 N 이고 [빼고 완료]가 빼는 대상이다. */
  outsideSelectedIds: string[];
};

function WizardMustVisitPick(props: PickWrapperProps): ReactElement {
  // 여행 지역은 위저드 스토어 목적지가 진다(TRIP-1042) — 판정 키인 코드는 거기에만 있다(URL `region` 은 이름뿐).
  const destinations = useTripWizardStore((s) => s.destinations);
  // 선택된 밖 행이 있을 때 완료가 멈춰 선 자리(TRIP-1106 AC-6) — 있으면 확인 다이얼로그가 뜬다.
  const [pending, setPending] = useState<WizardCompletion | null>(null);
  // 다이얼로그 버튼 잠금 — 상태가 아니라 ref 라 같은 틱 두 번째 누름도 이미 켜진 값을 읽는다(AC-11,
  // TRIP-1114 `lockedRef` 선례). 공용 `guardPress` 는 `pressGuardStructure` 가 소비처를 잠가 못 쓴다.
  const lockedRef = useRef(false);

  // 시드 → 재진입 표식 → 1/4 이동. 두 버튼·곧장 완료가 모두 이 한 곳을 지난다(step1 리터럴 하나).
  function finish(
    { selectedPoiIds, insideList }: WizardCompletion,
    dropPoiIds: string[]
  ): void {
    // 고를 수 있는 행 중 고른 것만 시드로 옮긴다(전부 아님 — TRIP-491 급소).
    const chosen = insideList.filter((saved) =>
      selectedPoiIds.includes(saved.place.poiId)
    );
    // 고를 수 있는 행이 없던 위저드 항목(담기를 푼 곳 · 지역 밖 행)은 원래 시드 그대로 남긴다(TRIP-1012 Q1 ·
    // BR-U1-04 — 조용히 빼면 INV-4). 단 사용자가 체크를 푼 항목은 되살리지 않고(03b 경고-1), [빼고 완료]면
    // 밖 행을 뺀다(TRIP-1106 AC-7 — 행이 없는 항목은 밖인지 알 수 없어 남긴다). 완료는 여전히 교체다.
    const store = useTripWizardStore.getState();
    const kept = store.mustVisits.filter(
      (m) =>
        selectedPoiIds.includes(m.sourcePoiId) &&
        !insideList.some((saved) => saved.place.poiId === m.sourcePoiId) &&
        !dropPoiIds.includes(m.sourcePoiId)
    );
    store.seedMustVisitsFromD02([...seedMustVisits(chosen), ...kept]);
    // 위저드 안 재진입이다 — 셸이 다시 마운트돼도 이미 만든 여행 id를 지우지 않게 한다(TRIP-1113).
    store.keepCreatedTripIdOnce();
    router.push('/trips/new/step1');
  }

  function resolve(exclude: boolean): void {
    if (!pending || lockedRef.current) return;
    lockedRef.current = true;
    setPending(null);
    finish(pending, exclude ? pending.outsideSelectedIds : []);
  }

  return (
    <View className="flex-1">
      <MustVisitPickSection
        {...props}
        destinations={destinations}
        // 초기값은 위저드에 이미 있는 꼭 갈 곳이다(TRIP-1012 #035 — '더 담기'로 오면 체크된 채 보인다).
        initialSelectedPoiIds={() =>
          useTripWizardStore.getState().mustVisits.map((m) => m.sourcePoiId)
        }
        onComplete={(selectedPoiIds, insideList, outsideList) => {
          const completion = {
            selectedPoiIds,
            insideList,
            outsideSelectedIds: outsideList
              .map((saved) => saved.place.poiId)
              .filter((poiId) => selectedPoiIds.includes(poiId)),
          };
          // 선택된 밖 행이 있으면 시드·표식·이동 전에 묻는다(AC-6 · INV-4 — 조용히 넣지 않는다). 떠 있는 동안
          // 완료를 또 눌러도 같은 다이얼로그를 다시 세울 뿐이다(AC-11).
          if (completion.outsideSelectedIds.length > 0) {
            lockedRef.current = false;
            setPending(completion);
            return;
          }
          finish(completion, []);
        }}
      />
      {pending ? (
        <MustVisitOutsideConfirmDialog
          count={pending.outsideSelectedIds.length}
          onExclude={() => resolve(true)}
          onKeep={() => resolve(false)}
        />
      ) : null}
    </View>
  );
}

/**
 * 여행 모드(TRIP-1093 결정 3) — h02 「꼭 갈 곳 추가」로 들어와 이미 만든 여행에 더한다. 여행 지역·이미
 * 등록된 곳은 서버에서 받고, 위저드 드래프트는 읽지도 쓰지도 않는다(다른 여행의 드래프트가 남아 있을 수
 * 있다). 완료 = 새로 고른 곳마다 ANYTIME POST(일괄 API 없음) → h02 가 보는 목록 캐시 무효화 → 뒤로.
 */
function TripMustVisitPick({
  tripId,
  state,
  orderedList,
  onRetry,
}: PickWrapperProps & { tripId: string }): ReactElement {
  const queryClient = useQueryClient();
  const trip = useGetTripsTripId(tripId);
  const registered = useGetTripsTripIdMustVisits(tripId);
  const [completeError, setCompleteError] = useState<string | null>(null);
  // 요청 중 잠금 — 응답 전 연타가 POST 를 겹쳐 내지 않게(AC-12).
  const submittingRef = useRef(false);

  const lockedPoiIds = (registered.data ?? []).map((m) => m.sourcePoiId);
  // 여행·등록 목록이 오기 전엔 결과를 그리지 않는다 — 목적지가 빈 채 판정하면 "전부 안"으로
  // fail-open 해 지역 밖이 잠깐 골라진다(AC-13 · 01 맹점 ③).
  const tripState: PlaceListState =
    trip.isError || registered.isError
      ? { kind: 'error' }
      : trip.isPending || registered.isPending
        ? { kind: 'loading' }
        : state;

  async function complete(
    selectedPoiIds: string[],
    insideList: SavedPlace[]
  ): Promise<void> {
    if (submittingRef.current) return;
    const poiIds = insideList
      .map((saved) => saved.place.poiId)
      .filter(
        (poiId) =>
          selectedPoiIds.includes(poiId) && !lockedPoiIds.includes(poiId)
      );
    if (poiIds.length === 0) return;
    submittingRef.current = true;
    setCompleteError(null);

    // allSettled — "N곳 중 M곳 실패"를 세야 해서 all(첫 실패에 던짐)로는 안 된다(TripNewStep1Page 선례).
    const results = await Promise.allSettled(
      poiIds.map((poiId) =>
        postTripsTripIdMustVisits(
          tripId,
          buildAnytimeMustVisitRequest({ poiId })
        )
      )
    );
    // 409 = 이미 그 여행에 있다 → 목표 상태와 같으니 성공(BR-U1-50).
    const failed = results.filter(
      (result) =>
        result.status === 'rejected' && !isAlreadyRegistered(result.reason)
    ).length;
    // 성공분이 있든 없든 다시 읽는다 — 실패여도 성공한 곳은 잠겨 재시도가 실패분만 보낸다(AC-11).
    void queryClient.invalidateQueries({
      queryKey: getGetTripsTripIdMustVisitsQueryKey(tripId),
    });
    if (failed > 0) {
      submittingRef.current = false;
      setCompleteError(mustVisitFailureNotice(poiIds.length, failed));
      return;
    }
    // 성공이면 잠금을 풀지 않는다 — 재조회를 기다리지 않아 잠금 목록이 아직 옛 값이라, 화면이
    // 사라지기 전 한 번 더 누르면 같은 곳을 또 보내고 back() 이 두 번 불린다(AC-12).
    router.back();
  }

  return (
    <MustVisitPickSection
      state={tripState}
      orderedList={orderedList}
      onRetry={() => {
        onRetry();
        if (trip.isError) void trip.refetch();
        if (registered.isError) void registered.refetch();
      }}
      destinations={trip.data?.destinations ?? []}
      initialSelectedPoiIds={() => []}
      lockedPoiIds={lockedPoiIds}
      completeError={completeError}
      onToggle={() => setCompleteError(null)}
      onComplete={(selectedPoiIds, insideList) =>
        void complete(selectedPoiIds, insideList)
      }
    />
  );
}

export function SavedPlacesPage(): ReactElement {
  const [removeError, setRemoveError] = useState<PlaceSaveNotice | null>(null);
  const [lastAttempted, setLastAttempted] = useState<LastAttempt | null>(null);
  // 이번 방문에서 하트를 눌러 해제한(빈 하트) poiId 들. 화면을 떠나면(재마운트) 리셋된다(Q1=a).
  const [releasedPoiIds, setReleasedPoiIds] = useState<Set<string>>(
    () => new Set()
  );
  // 해제한 항목의 원본 스냅숏(poiId→SavedPlace) — 서버에서 빠져도 행을 그리고, 되돌리기가
  // 준 더 늦은 savedAt 대신 원 savedAt 으로 정렬 위치를 지킨다(같은 자리 복귀, 02a ★3).
  const [snapshots, setSnapshots] = useState<Map<string, SavedPlace>>(
    () => new Map()
  );

  // 여행 지역 필터(TRIP-689) — g01·꼭 갈 곳의 '더 담기'가 d02로 올 때 실어 보낸 region.
  // expo-router는 1원소 배열 파라미터를 문자열로 되돌릴 수 있어(단일 목적지 여행) 배열로 정규화한다.
  // mode='select'(TRIP-706)면 담기/해제가 아니라 '꼭 갈 곳 고르기' 화면으로 갈린다(AC-3).
  // tripId 가 함께 오면 select 는 여행 모드다(TRIP-1093 — h02 「꼭 갈 곳 추가」).
  const { mode, region, tripId } = useLocalSearchParams<{
    mode?: string;
    region?: string | string[];
    tripId?: string;
  }>();
  const regions = Array.isArray(region) ? region : region ? [region] : [];

  const isAuthed = getAccessToken() !== null;
  const { savedPlaces, isPending, isError, refetch, save, remove } =
    useSavedPlaces({ isAuthed });

  const orderedList = buildDisplayList(savedPlaces, releasedPoiIds, snapshots);
  // save 모드 — region 파라미터가 있으면 여행 지역 안 저장만 남긴다(fail-open은 순수함수가 진다). 없으면 전체.
  const displayList =
    regions.length > 0
      ? filterSavedPlacesByTripRegions(orderedList, regions)
      : orderedList;
  // 저장은 있는데 지역 필터로 0건이면 "담은 곳 없음"이 아니라 구분 안내를 그린다(AC-5).
  const regionFilterEmpty =
    regions.length > 0 && orderedList.length > 0 && displayList.length === 0;
  // select 모드는 지역 안·밖을 모두 그리므로(TRIP-1042) 얼굴 판정은 담은 곳 전체 개수로 한다 — 지역 안이
  // 0건이어도 results 얼굴 안에 region-empty 블록이 뜬다(진짜 0곳 얼굴은 담은 곳이 0일 때만).
  const listState = resolvePlaceListState({
    isPending,
    isError,
    itemCount: mode === 'select' ? orderedList.length : displayList.length,
    hasQuery: false,
    hasCategory: false,
  });

  // 해제 — 낙관 업데이트: 먼저 빈 하트로 바꾸고(스냅숏 보존) 서버에 DELETE. 실패면 찬 하트로 원복.
  async function attemptRelease(saved: SavedPlace): Promise<void> {
    const { poiId } = saved.place;
    setRemoveError(null);
    setLastAttempted({ saved, mode: 'release' });
    setSnapshots((prev) => new Map(prev).set(poiId, saved));
    setReleasedPoiIds((prev) => new Set(prev).add(poiId));

    const outcome = await remove(poiId);
    if (outcome.kind === 'failed') {
      setReleasedPoiIds((prev) => {
        const next = new Set(prev);
        next.delete(poiId);
        return next;
      });
      setRemoveError(REMOVE_FAILURE_NOTICE[outcome.reason]);
    }
  }

  // 되돌리기 — 낙관 업데이트: 먼저 찬 하트로 바꾸고 서버에 POST(재담김). 실패면 빈 하트로 원복.
  async function attemptRestore(saved: SavedPlace): Promise<void> {
    const { poiId } = saved.place;
    setRemoveError(null);
    setLastAttempted({ saved, mode: 'restore' });
    setReleasedPoiIds((prev) => {
      const next = new Set(prev);
      next.delete(poiId);
      return next;
    });

    const outcome = await save(saved.place);
    if (outcome.kind === 'failed') {
      setReleasedPoiIds((prev) => new Set(prev).add(poiId));
      setRemoveError(SAVE_FAILURE_NOTICE[outcome.reason]);
    }
  }

  function handlePressRemove(saved: SavedPlace): void {
    void attemptRelease(saved);
  }

  function handlePressRestore(saved: SavedPlace): void {
    void attemptRestore(saved);
  }

  function handleRetry(): void {
    setRemoveError(null);
    void refetch();
  }

  function handlePressRemoveErrorAction(): void {
    if (removeError?.action === 'login') {
      router.push('/(auth)/login');
      return;
    }
    if (removeError?.action === 'retry' && lastAttempted) {
      void (lastAttempted.mode === 'release'
        ? attemptRelease(lastAttempted.saved)
        : attemptRestore(lastAttempted.saved));
    }
  }

  // select 모드(TRIP-706) — 담기/해제 대신 '꼭 갈 곳 고르기'. 카탈로그 구독은 그 하위 컴포넌트에만
  // 둔다 — save 모드에서 `GET /regions` 가 나가지 않게(03b 참고-5).
  if (mode === 'select') {
    return tripId ? (
      <TripMustVisitPick
        tripId={tripId}
        state={listState}
        orderedList={orderedList}
        onRetry={handleRetry}
      />
    ) : (
      <WizardMustVisitPick
        state={listState}
        orderedList={orderedList}
        onRetry={handleRetry}
      />
    );
  }

  return (
    <SavedPlaceListScreen
      savedPlaces={displayList}
      state={listState}
      regionFilterEmpty={regionFilterEmpty}
      removeError={removeError}
      isGuest={!isAuthed}
      releasedPoiIds={[...releasedPoiIds]}
      onPressRemove={handlePressRemove}
      onPressRestore={handlePressRestore}
      onPressRow={(saved) =>
        router.push(`/explore/places/${saved.place.poiId}`)
      }
      onPressCreateTrip={() => {
        // TRIP-458 → 사용자 결정으로 갱신: 위저드 진입마다 도는 자동 시드는 폐지됐지만(다른
        // 진입점 — FAB "여행 만들기" 등 — 은 항상 빈 상태), **이 버튼은 "이 장소들로" 만들겠다는
        // 명시적 선택**이라 여기서 직접 심는다. 지금 화면에 그려진 목록(빈 하트로 해제한 항목은
        // 제외)을 시드로 얹고, 위저드 셸의 마운트 초기화가 그걸 지우지 않도록 표시까지 함께 켠다
        // (`seedMustVisitsFromD02` — `tripWizardStore.ts` 참고).
        const activePlaces = displayList.filter(
          (saved) => !releasedPoiIds.has(saved.place.poiId)
        );
        // 새 여행 진입이다(TRIP-1012 #031·#074) — 직전 드래프트를 비운 **뒤에** 시드한다. 거꾸로면
        // reset 이 방금 켠 `preserveMustVisitsOnce` 를 꺼 셸이 시드를 지운다. 여행지는 추정하지 않는다.
        const store = useTripWizardStore.getState();
        store.reset();
        store.seedMustVisitsFromD02(seedMustVisits(activePlaces));
        router.push('/trips/new/step1');
      }}
      onPressBrowse={() => router.push('/explore/places')}
      onRetry={handleRetry}
      onPressLogin={() => router.push('/(auth)/login')}
      onPressRemoveErrorAction={handlePressRemoveErrorAction}
      onBack={() => router.back()}
    />
  );
}
