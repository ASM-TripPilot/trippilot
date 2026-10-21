/**
 * d04 장소 탐색 배선(TRIP-221·TRIP-222·TRIP-502 · US-EXPL-04 · US-SHELL-05). `usePlacesInfinite`로
 * `region`(라우트 파라미터, 없으면 생략 — 01b Seed Q9)·`category`(칩 선택)·`q`(검색어)를 물어
 * **서버**가 필터·정렬·페이지네이션을 하고, 스크롤로 다음 장을 이어 받는다(TRIP-502 — 전량 수신·
 * 로드된 페이지 한정 검색을 없앤다). 카테고리·검색어 상태를 이 파일이 전부 소유한다 —
 * `PlaceExploreScreen`은 `useState` 금지(구조 가드), 판정의 단일 출처가 두 층으로 갈리면 안 된다.
 *
 * `resolvePlaceListState`(TRIP-222)를 여기서만 부른다 — 화면은 `state` 판별 유니온만 받아
 * 그린다(AC-G3). `itemCount`는 화면에 실제로 그려질 개수(`visiblePlaces` 결과 길이, 01b Seed
 * Q2)라 카테고리로 0건이든 검색어로 0건이든 같은 계산에서 나온다.
 *
 * 담기 실패 4갈래(`SavedPlacesOutcome`)는 이 칸부터 읽는다(TRIP-221 03b W-2 이관분) —
 * `attemptToggle`이 응답을 기다리는 동안 `pendingPoiIds`에 그 poiId를 올려 화면이 하트를
 * 비활성화하게 하고(01b Seed Q7 ⓑ, 응답 전 두 번째 누름이 유실되던 자리를 없앤다), 실패하면
 * `saveError`를 세워 배너로 올린다. 배너는 타이머 없이 **다음 조작**(검색·카테고리·필터
 * 해제·재조회·새 담기 시도)이 지운다(01b Seed Q5).
 *
 * `isAuthed`는 `getAccessToken() !== null`(01b Seed Q1) — 동기라서 "판정 대기" 제3 상태가
 * 안 생긴다. 담긴 목록은 `useSavedPlaces`가 한 곳에서 낸다(01b Seed Q2 ⓐ).
 */
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import type { Place, PoiCategory } from '@/shared/api/index.schemas';
import { getAccessToken } from '@/shared/api';
import { guardPress } from '@/shared/lib/pressGuard';
import { BottomTabBar, shellTabHref } from '@/shared/ui/BottomTabBar';

import { resolvePlaceListState } from '@/features/explore';
import {
  COORD_BLOCKED_NOTICE,
  hasUsableCoords,
  SAVE_FAILURE_NOTICE,
  type PlaceSaveNotice,
} from '@/features/save-place';
import { usePlacesInfinite } from '@/features/explore';
import { useMultiRegionPlaces } from '@/features/explore';
import { useSavedPlaces } from '@/features/save-place';
import { regionPickerHref } from '@/features/explore';
import { isWizardOrigin } from '@/features/create-trip';
import { SERVICE_REGIONS } from '@/entities/trip';
import { PlaceExploreScreen } from './PlaceExploreScreen';
import { useTripWizardStore } from '@/features/create-trip';

// 지역 미지정이면 서버 전국 조회 대신 서비스 지역을 묻는다(TRIP-1560) — 홈·d01 과 같은 배열·순서라 응답 캐시를 나눠 쓴다.
const SERVICE_REGION_NAMES = SERVICE_REGIONS.map((r) => r.name);

export function PlaceExplorePage(): ReactElement {
  const params = useLocalSearchParams<{ region?: string | string[] }>();
  const { region } = params;
  // 위저드에서 들른 d04 는 ＋(새 여행 = reset)를 그리지 않는다 — 진행 중 입력 보존(TRIP-1026).
  const fromWizard = isWizardOrigin(params);
  // '더 담기'가 여행 지역들을 배열로 실어 보낸다(TRIP-687, 같은 키 반복 → 배열). 1지역은 기존
  // 무한스크롤 경로를, 0지역(서비스 지역 전체, TRIP-1560)·2+지역은 지역별 병렬 조회 후 병합 경로를
  // 탄다(어느 쪽이 그려지는지는 6-b 실기). 칩 라벨은 라우트 `regions` 그대로라 0지역이면 '전체 지역'이다.
  const regions = Array.isArray(region) ? region : region ? [region] : [];
  const isMultiRegion = regions.length !== 1;
  const singleRegion = regions.length === 1 ? regions[0] : undefined;
  const multiQueryRegions =
    regions.length === 0 ? SERVICE_REGION_NAMES : regions;

  const [selectedCategory, setSelectedCategory] = useState<PoiCategory | null>(
    null
  );
  const [searchText, setSearchText] = useState('');
  const [pendingPoiIds, setPendingPoiIds] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<PlaceSaveNotice | null>(null);
  const [lastAttempted, setLastAttempted] = useState<Place | null>(null);

  const isAuthed = getAccessToken() !== null;

  // 검색은 서버가 한다(q) — 클라 필터는 "받아온 페이지 안에서만" 검색이라 결과가 조용히 빠진다
  // (TRIP-502 선행 조건). 무한 스크롤은 nextCursor 로 이어 받는다(첫 장만 받고 스크롤에 따라 추가).
  const trimmedQuery = searchText.trim();
  // 두 훅 모두 무조건 호출하고 enabled 로 게이팅한다(훅 규칙) — 다지역이면 단발 조회를 꺼
  // 헛조회를 막고, 단일/0지역이면 병합 조회를 끈다.
  const infinite = usePlacesInfinite(
    {
      ...(singleRegion ? { region: singleRegion } : {}),
      ...(selectedCategory ? { category: selectedCategory } : {}),
      ...(trimmedQuery ? { q: trimmedQuery } : {}),
    },
    { enabled: !isMultiRegion }
  );
  const multi = useMultiRegionPlaces(multiQueryRegions, {
    category: selectedCategory,
    q: trimmedQuery,
  });
  const {
    items,
    isPending,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = isMultiRegion ? multi : infinite;
  const { isSaved, save, remove, savedPoiIds } = useSavedPlaces({ isAuthed });

  const listState = resolvePlaceListState({
    isPending,
    isError,
    itemCount: items.length,
    hasQuery: trimmedQuery !== '',
    hasCategory: selectedCategory !== null,
  });

  function handleEndReached(): void {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }

  async function attemptToggle(place: Place): Promise<void> {
    setSaveError(null);
    setLastAttempted(place);

    const alreadySaved = isSaved(place.poiId);
    // BR-U1-02 · Q12 — 좌표 방어는 새로 담을 때만 건다. 이미 담긴 장소를 해제하는 길을
    // 막으면 사용자가 영영 뺄 수 없는 카드가 생긴다. 계약상 실제로는 발동하지 않는다
    // (`Place.lat`·`lng`는 required·non-nullable) — 미충족으로 기록한다.
    if (!alreadySaved && !hasUsableCoords(place)) {
      setSaveError(COORD_BLOCKED_NOTICE);
      return;
    }

    setPendingPoiIds((ids) => [...ids, place.poiId]);
    const outcome = alreadySaved
      ? await remove(place.poiId)
      : await save(place);
    setPendingPoiIds((ids) => ids.filter((id) => id !== place.poiId));

    if (outcome.kind === 'failed') {
      setSaveError(SAVE_FAILURE_NOTICE[outcome.reason]);
    }
  }

  // TRIP-1349 — 카드(memo)에 내려가는 두 콜백은 참조가 렌더 간 같아야 memo 가 먹는다. attemptToggle 은
  // 매 렌더 새 클로저(isSaved·save·remove 를 닫는다)라 ref 로 최신본을 읽는다.
  const attemptToggleRef = useRef(attemptToggle);
  useEffect(() => {
    attemptToggleRef.current = attemptToggle;
  });
  const handleToggleSave = useCallback((place: Place): void => {
    // 판정(담기냐 해제냐)은 attemptToggle 안에서 한다 — 화면은 "이 카드가 눌렸다"만 올린다.
    void attemptToggleRef.current(place);
  }, []);
  // TRIP-1282 — 홈 "더 보기"의 창 안이면 무시(연타 관통 표적).
  const handlePressCard = useMemo(
    () =>
      guardPress((place: Place) =>
        router.push(`/explore/places/${place.poiId}`)
      ),
    []
  );

  function handleChangeSearchText(text: string): void {
    setSaveError(null);
    setSearchText(text);
  }

  function handleSelectCategory(category: PoiCategory | null): void {
    setSaveError(null);
    setSelectedCategory(category);
  }

  function handleClearFilter(): void {
    setSaveError(null);
    if (listState.kind !== 'filter-zero') return;
    if (listState.blame === 'search') {
      setSearchText('');
    } else {
      setSelectedCategory(null);
    }
  }

  function handleClearAllFilters(): void {
    setSaveError(null);
    setSearchText('');
    setSelectedCategory(null);
  }

  function handleRetry(): void {
    setSaveError(null);
    void refetch();
  }

  function handlePressSaveErrorAction(): void {
    if (saveError?.action === 'login') {
      router.push('/(auth)/login');
      return;
    }
    if (saveError?.action === 'retry' && lastAttempted) {
      void attemptToggle(lastAttempted);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <PlaceExploreScreen
        places={items}
        savedPoiIds={savedPoiIds}
        selectedCategory={selectedCategory}
        searchText={searchText}
        onSelectCategory={handleSelectCategory}
        onChangeSearchText={handleChangeSearchText}
        onToggleSave={handleToggleSave}
        onPressCard={handlePressCard}
        onPressCreateTrip={() => {
          // 새 여행 진입 — 직전 드래프트를 이동 전에 비운다(TRIP-1012 #074).
          useTripWizardStore.getState().reset();
          router.push('/trips/new/step1');
        }}
        hideCreateTrip={fromWizard}
        onPressSavedPlaces={() =>
          // 위저드 출처면 바로 아래가 d02 select 다 — save 모드를 새로 열면 그 CTA 가 드래프트를
          // reset 한다. 한 칸 뒤로 가 고르던 체크를 이어 간다(TRIP-1093 결정 2). 이 전제를
          // 지키는 심판은 없다(생산자 소스 스캔은 TRIP-1145 에서 지웠다).
          fromWizard ? router.back() : router.push('/explore/saved-places')
        }
        onBack={() => router.back()}
        state={listState}
        pendingPoiIds={pendingPoiIds}
        saveError={saveError}
        onRetry={handleRetry}
        onPressChangeRegion={() => router.push(regionPickerHref('places'))}
        regionNames={regions}
        onClearFilter={handleClearFilter}
        onClearAllFilters={handleClearAllFilters}
        onPressSaveErrorAction={handlePressSaveErrorAction}
        onEndReached={handleEndReached}
        isFetchingMore={isFetchingNextPage}
        degraded={isMultiRegion && !isError ? multi.degraded : false}
      />

      {/* (tabs) 밖 라우트라 진짜 탭바가 없다 — 옛 목적지 상세(TRIP-1105 로 삭제) 선례처럼 복제해 그리고,
          onPressTab은 dismissTo로 항법한다 — 스택 밑의 (tabs)까지 사이 화면(위저드 등)을 걷어낸다.
          replace는 이 화면만 (tabs)로 바꿔 아래 스택이 남았다(TRIP-1262 · QA F4). 스택에 (tabs)가
          없으면(콜드 오픈) dismissTo가 지금 화면을 그 탭으로 교체한다. */}
      <BottomTabBar
        activeKey="explore"
        onPressTab={(key) => router.dismissTo(shellTabHref(key))}
      />
    </View>
  );
}
