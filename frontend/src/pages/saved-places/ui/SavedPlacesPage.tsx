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
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import type { SavedPlace } from '@/shared/api/generated/schemas';
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
import { MustVisitPickScreen } from '@/features/explore/ui/MustVisitPickScreen';
import { SavedPlaceListScreen } from '@/features/explore/ui/SavedPlaceListScreen';
import { seedMustVisits } from '@/features/trip/model/mustVisitSeed';
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
 * 하위 컴포넌트가 선택 집합을 소유해 완료 시 **선택분만** 시드한다(D2 · AC-1 TRIP-491 재현 봉합).
 * select-empty 얼굴은 진짜로 담은 곳이 0일 때만 뜬다(save 모드의 RegionEmptyBlock 은 select 에 없다).
 */
function MustVisitPickSection({
  state,
  orderedList,
  onRetry,
}: {
  state: PlaceListState;
  orderedList: SavedPlace[];
  onRetry: () => void;
}): ReactElement {
  // 고른 poiId 들 — 초기값은 위저드에 이미 있는 꼭 갈 곳이다(TRIP-1012 #035 — '더 담기'로 오면 체크된 채 보인다).
  const [selectedPoiIds, setSelectedPoiIds] = useState<string[]>(() =>
    useTripWizardStore.getState().mustVisits.map((m) => m.sourcePoiId)
  );
  // 여행 지역은 위저드 스토어 목적지가 진다(TRIP-1042) — 판정 키인 코드는 거기에만 있다
  // (URL `region` 은 이름뿐). 행 위치의 시도 짧은 이름은 서버 카탈로그에서 얻는다(상수표 없음, TRIP-445).
  const destinations = useTripWizardStore((s) => s.destinations);
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
  // 선택 수·완료 활성·시드는 **고를 수 있는 행** 안의 선택만 센다 — 안 보이는 선택이나 밖 행의 선택이
  // "N곳 선택됨"에 남으면 시드와 어긋난다(TRIP-982 A8 · TRIP-1042 AC-11).
  const visibleSelectedPoiIds = selectedPoiIds.filter((id) =>
    insideList.some((saved) => saved.place.poiId === id)
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
      onToggleSelect={(poiId) =>
        setSelectedPoiIds((prev) =>
          prev.includes(poiId)
            ? prev.filter((id) => id !== poiId)
            : [...prev, poiId]
        )
      }
      onComplete={() => {
        // 고를 수 있는 행 중 고른 것만 시드로 옮긴다(전부 아님 — TRIP-491 급소, 밖 행 제외 — AC-10).
        const chosen = insideList.filter((saved) =>
          selectedPoiIds.includes(saved.place.poiId)
        );
        // 고를 수 있는 행이 없던 위저드 항목(담기를 푼 곳 · 지역 밖 행)은 뺀 것으로 치지 않고 원래 시드
        // 그대로 남긴다(TRIP-1012 Q1 · BR-U1-04 · TRIP-1042 Q2 — 조용히 빼면 INV-4). 단 사용자가 체크를
        // 푼 항목은 그 뒤 목록에서 사라져도 되살리지 않는다(03b 경고-1). 완료는 여전히 교체다.
        const store = useTripWizardStore.getState();
        const kept = store.mustVisits.filter(
          (m) =>
            selectedPoiIds.includes(m.sourcePoiId) &&
            !insideList.some((saved) => saved.place.poiId === m.sourcePoiId)
        );
        store.seedMustVisitsFromD02([...seedMustVisits(chosen), ...kept]);
        router.push('/trips/new/step1');
      }}
      onPressAddMore={() => router.push(exploreHref)}
      onRetry={onRetry}
      onPressBrowse={() => router.push(exploreHref)}
      onBack={() => router.back()}
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
  const { mode, region } = useLocalSearchParams<{
    mode?: string;
    region?: string | string[];
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
    return (
      <MustVisitPickSection
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
