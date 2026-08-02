/**
 * d04 장소 탐색 배선(TRIP-221·TRIP-222 · US-EXPL-04 · US-SHELL-05). `useGetPlaces`로 `region`
 * (라우트 파라미터, 없으면 생략 — 01b Seed Q9)·`category`(카테고리 칩 선택)를 물어 서버
 * 재조회를 일으키고, 정렬·검색은 `visiblePlaces`로 클라에서 끝낸다(서버는 다시 안 부른다).
 * 카테고리·검색어 상태를 이 파일이 전부 소유한다 — `PlaceExploreScreen`은 `useState` 금지
 * (구조 가드), 판정의 단일 출처가 두 층으로 갈리면 안 된다.
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
 * 안 생긴다. 담긴 목록·CTA 숫자는 `useSavedPlaces`가 한 곳에서 낸다(01b Seed Q2 ⓐ).
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { useGetPlaces } from '@/shared/api/generated/places/places';
import type { Place, PoiCategory } from '@/shared/api/generated/schemas';
import { getAccessToken } from '@/shared/api/tokenManager';

import { resolvePlaceListState } from '@/features/explore/model/placeListState';
import {
  COORD_BLOCKED_NOTICE,
  hasUsableCoords,
  SAVE_FAILURE_NOTICE,
  type PlaceSaveNotice,
} from '@/features/explore/model/placeSaveGuard';
import { visiblePlaces } from '@/features/explore/model/placeListView';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { PlaceExploreScreen } from '@/features/explore/ui/PlaceExploreScreen';

export function PlaceExplorePage(): ReactElement {
  const { region } = useLocalSearchParams<{ region?: string }>();
  const rawRegion = Array.isArray(region) ? region[0] : region;

  const [selectedCategory, setSelectedCategory] = useState<PoiCategory | null>(
    null
  );
  const [searchText, setSearchText] = useState('');
  const [pendingPoiIds, setPendingPoiIds] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<PlaceSaveNotice | null>(null);
  const [lastAttempted, setLastAttempted] = useState<Place | null>(null);

  const isAuthed = getAccessToken() !== null;

  const { data, isPending, isError, refetch } = useGetPlaces({
    ...(rawRegion ? { region: rawRegion } : {}),
    ...(selectedCategory ? { category: selectedCategory } : {}),
  });
  const { isSaved, save, remove, savedPoiIds } = useSavedPlaces({ isAuthed });

  const visible = visiblePlaces(data ?? [], searchText);
  const listState = resolvePlaceListState({
    isPending,
    isError,
    itemCount: visible.length,
    hasQuery: searchText.trim() !== '',
    hasCategory: selectedCategory !== null,
  });

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
    <PlaceExploreScreen
      places={visible}
      savedPoiIds={savedPoiIds}
      selectedCategory={selectedCategory}
      searchText={searchText}
      onSelectCategory={handleSelectCategory}
      onChangeSearchText={handleChangeSearchText}
      onToggleSave={handleToggleSave}
      onPressCreateTrip={() => router.push('/trips/new/step1')}
      onBack={() => router.back()}
      state={listState}
      pendingPoiIds={pendingPoiIds}
      saveError={saveError}
      onRetry={handleRetry}
      onPressChangeRegion={() => router.push('/explore/region?purpose=trip')}
      onClearFilter={handleClearFilter}
      onPressSaveErrorAction={handlePressSaveErrorAction}
    />
  );
}
