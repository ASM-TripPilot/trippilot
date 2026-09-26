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
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { Place } from '@/shared/api/generated/schemas';
import { PoiCategory } from '@/shared/api/generated/schemas';
import { getAccessToken } from '@/shared/api/tokenManager';
import { BottomTabBar } from '@/shared/ui/BottomTabBar';

import { resolvePlaceListState } from '@/features/explore/model/placeListState';
import {
  COORD_BLOCKED_NOTICE,
  hasUsableCoords,
  SAVE_FAILURE_NOTICE,
  type PlaceSaveNotice,
} from '@/features/explore/model/placeSaveGuard';
import { usePlacesInfinite } from '@/features/explore/model/usePlacesInfinite';
import { useMultiRegionPlaces } from '@/features/explore/model/useMultiRegionPlaces';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { regionPickerHref } from '@/features/explore/model/regionPickerPurpose';
import { PlaceExploreScreen } from '@/features/explore/ui/PlaceExploreScreen';

/** 카테고리 시트(TRIP-708 AC-6) — **페이지가 소유**한다(@gorhom/bottom-sheet). 열림 상태는
 * 페이지 `useState`이고, 닫히면 트리에서 통째로 사라진다(조건부 마운트) — gorhom 목이 통과형
 * (어떤 prop이든 children 렌더)이라 "열림"은 마운트/언마운트로만 관측된다(실개폐·딤·snap은
 * 6-b 실기). 화면(`PlaceExploreScreen`)에 두면 화면 순수성(useState 0)이 깨지므로 여기 둔다.
 * 헤더의 CategoryChips와 testID가 겹치지 않도록 `-sheet-` 접두를 쓴다(항상 닫혀 있어 실제
 * 충돌은 없지만 방어적으로 분리). */
function renderCategorySheetBackdrop(
  props: BottomSheetBackdropProps
): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

const CATEGORY_SHEET_CHIPS: {
  key: string;
  label: string;
  value: PoiCategory | null;
}[] = [
  { key: 'all', label: '전체', value: null },
  ...Object.values(PoiCategory).map((category) => ({
    key: category,
    label: category,
    value: category,
  })),
];

function CategorySheet({
  selected,
  onSelect,
  onClose,
}: {
  selected: PoiCategory | null;
  onSelect: (category: PoiCategory | null) => void;
  onClose: () => void;
}): ReactElement {
  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderCategorySheetBackdrop}
    >
      <BottomSheetView
        testID="explore-places-category-sheet"
        className="w-full gap-lg px-lg pb-2xl pt-sm"
      >
        <Text className="font-noto-bold text-section font-bold text-ink">
          카테고리
        </Text>
        <View className="w-full flex-row flex-wrap gap-sm">
          {CATEGORY_SHEET_CHIPS.map((chip) => {
            const isSelected = chip.value === selected;
            return (
              <Pressable
                key={chip.key}
                testID={`explore-places-sheet-category-${chip.key}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  onSelect(chip.value);
                  onClose();
                }}
                className={
                  isSelected
                    ? 'rounded-pill bg-primary px-md py-sm'
                    : 'rounded-pill border border-hairline-strong bg-canvas px-md py-sm'
                }
              >
                <Text
                  className={
                    isSelected
                      ? 'font-noto-bold text-label font-bold text-on-primary'
                      : 'font-noto-bold text-label font-bold text-ink'
                  }
                >
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

export function PlaceExplorePage(): ReactElement {
  const { region } = useLocalSearchParams<{ region?: string | string[] }>();
  // '더 담기'가 여행 지역들을 배열로 실어 보낸다(TRIP-687, 같은 키 반복 → 배열). 0/1지역은 기존
  // 무한스크롤 경로를, 2+지역은 지역별 병렬 조회 후 병합 경로를 탄다(어느 쪽이 그려지는지는 6-b 실기).
  const regions = Array.isArray(region) ? region : region ? [region] : [];
  const isMultiRegion = regions.length >= 2;
  const singleRegion = regions.length <= 1 ? regions[0] : undefined;

  const [selectedCategory, setSelectedCategory] = useState<PoiCategory | null>(
    null
  );
  const [searchText, setSearchText] = useState('');
  const [pendingPoiIds, setPendingPoiIds] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<PlaceSaveNotice | null>(null);
  const [lastAttempted, setLastAttempted] = useState<Place | null>(null);
  // 카테고리 시트 열림 — 필터 버튼 press가 연다(AC-6, 조건부 마운트).
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);

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
  const multi = useMultiRegionPlaces(regions, {
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

  function handleToggleSave(place: Place): void {
    // 판정(담기냐 해제냐)은 attemptToggle 안에서 한다 — 화면은 "이 카드가 눌렸다"만 올린다.
    void attemptToggle(place);
  }

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
        onPressCard={(place) => router.push(`/explore/places/${place.poiId}`)}
        onPressCreateTrip={() => router.push('/trips/new/step1')}
        onPressSavedPlaces={() => router.push('/explore/saved-places')}
        onPressFilter={() => setCategorySheetOpen(true)}
        onBack={() => router.back()}
        state={listState}
        pendingPoiIds={pendingPoiIds}
        saveError={saveError}
        onRetry={handleRetry}
        onPressChangeRegion={() => router.push(regionPickerHref('places'))}
        onClearFilter={handleClearFilter}
        onPressSaveErrorAction={handlePressSaveErrorAction}
        onEndReached={handleEndReached}
        isFetchingMore={isFetchingNextPage}
        degraded={isMultiRegion && !isError ? multi.degraded : false}
      />

      {/* (tabs) 밖 라우트라 진짜 탭바가 없다 — DestinationDetail 선례처럼 복제해 그리고,
          onPressTab은 push가 아니라 replace로 항법한다(뒤로가기 스택을 안 쌓는다). */}
      <BottomTabBar
        activeKey="explore"
        onPressTab={(key) => router.replace(key === 'home' ? '/' : `/${key}`)}
      />

      {/* 카테고리 시트 — 필터 버튼이 열고, 닫힘=트리 부재(조건부 마운트). */}
      {categorySheetOpen ? (
        <CategorySheet
          selected={selectedCategory}
          onSelect={handleSelectCategory}
          onClose={() => setCategorySheetOpen(false)}
        />
      ) : null}
    </View>
  );
}
