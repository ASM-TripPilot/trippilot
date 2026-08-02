/**
 * d04 장소 탐색 배선(TRIP-221 · US-EXPL-04 · US-SHELL-05). `useGetPlaces`로 `region`(라우트
 * 파라미터, 없으면 생략 — 01b Seed Q9)·`category`(카테고리 칩 선택, 01b Seed §2 원칙대로
 * "가까운 순"·`q` 같은 계약에 없는 파라미터는 만들지 않는다)를 물어 서버 재조회를 일으키고,
 * 정렬·검색은 `visiblePlaces`로 클라에서 끝낸다(AC-7·AC-8, 서버는 다시 안 부른다). 카테고리·
 * 검색어 상태를 이 파일이 전부 소유한다 — 카테고리가 쿼리 파라미터와 같은 층에 살아야 하고,
 * 검색만 화면에 두면 판정의 단일 출처가 두 층으로 갈린다(`PlaceExploreScreen`은 `useState`
 * 금지, 구조 가드).
 *
 * `isAuthed`는 `getAccessToken() !== null`(01b Seed Q1) — 동기라서 "판정 대기" 제3 상태가
 * 안 생긴다. 담긴 목록·CTA 숫자는 `useSavedPlaces`가 한 곳에서 낸다(01b Seed Q2 ⓐ) —
 * 페이지가 `GET /saved-places`를 따로 부르면 `enabled: isAuthed` 가드를 두 곳에 복제하게
 * 되고, 그 복제가 TRIP-220 W-3이 났던 자리다.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { useGetPlaces } from '@/shared/api/generated/places/places';
import type { Place, PoiCategory } from '@/shared/api/generated/schemas';
import { getAccessToken } from '@/shared/api/tokenManager';

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

  const isAuthed = getAccessToken() !== null;

  const { data } = useGetPlaces({
    ...(rawRegion ? { region: rawRegion } : {}),
    ...(selectedCategory ? { category: selectedCategory } : {}),
  });
  const { isSaved, save, remove, savedPoiIds } = useSavedPlaces({ isAuthed });

  function handleToggleSave(place: Place): void {
    // 판정(담기냐 해제냐)은 여기서 한다 — 화면은 "이 카드가 눌렸다"만 올린다(구조 가드 AC-G5).
    if (isSaved(place.poiId)) {
      void remove(place.poiId);
      return;
    }
    void save(place);
  }

  return (
    <PlaceExploreScreen
      places={visiblePlaces(data ?? [], searchText)}
      savedPoiIds={savedPoiIds}
      selectedCategory={selectedCategory}
      searchText={searchText}
      onSelectCategory={setSelectedCategory}
      onChangeSearchText={setSearchText}
      onToggleSave={handleToggleSave}
      onPressCreateTrip={() => router.push('/trips/new/step1')}
      onBack={() => router.back()}
    />
  );
}
