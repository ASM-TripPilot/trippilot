/**
 * d05 통합 검색 배선 — 검색어 하나로 지역·장소·숙소 3소스를 각각 팬아웃하고 세 섹션으로
 * 그린다(TRIP-450 · US-EXPL-01~04 · INV-4).
 *
 * 왜 페이지가 조회를 무는가: 화면(`UnifiedSearchScreen`, features/explore)은
 * `placeExploreStructure` 재귀 스캔이 `@/features/stay` import·훅을 0건 강제하는 순수
 * 프레젠테이션이라, 숙소 훅(`useStaySearch`)을 부를 수 없다. pages 는 features 여럿을 조합할
 * 수 있으므로 3소스 조회·조합은 이 페이지가 진다(d01 라우트 격리와 동형).
 *
 * 3소스:
 *  · 여행지 — `useRegions({ q })`(서버 별칭 매칭). 결과 첫 매치가 숙소 2단 조회의 지역명이 된다.
 *  · 장소   — `useGetPlaces()` + `visiblePlaces(data, q)`(이름 클라 필터, 서버 키워드 없음).
 *  · 숙소   — `useStaySearch({ region }, { enabled })` — region 은 **특정된 카탈로그명**뿐이고
 *            지역을 못 특정하면 `enabled:false` 로 껐다(자유 문자열이 region= 으로 새는 걸
 *            막는다, TRIP-412 되돌림의 경계). 지역 오류·0매치는 둘 다 "지역 못 찾음" 안내.
 *
 * 섹션 독립 실패(INV-4): 세 쿼리의 `isError` 를 각 섹션이 따로 읽어 그 섹션만 재시도를 띄운다.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { formatPrice } from '@/features/stay/model/formatPrice';
import { stayKey } from '@/features/stay/model/stayKey';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { useRegions } from '@/features/explore/model/regions';
import { visiblePlaces } from '@/features/explore/model/placeListView';
import { useGetPlaces } from '@/shared/api/generated/places/places';
import { UnifiedSearchScreen } from '@/features/explore/ui/UnifiedSearchScreen';

export function UnifiedSearchPage(): ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const [searchText, setSearchText] = useState(params.q ?? '');

  const regions = useRegions({ q: searchText });
  const places = useGetPlaces();

  // 숙소 2단 조회의 1단 — 검색어로 특정된 **카탈로그 지역 이름**(예 '부산' → '부산광역시').
  // 지역을 못 특정하면(0매치·조회 오류) undefined 라, 아래 쿼리가 `enabled:false` 로 꺼진다.
  const regionList = regions.data ?? [];
  const resolvedRegionName = regionList[0]?.name;
  const stays = useStaySearch(
    { region: resolvedRegionName },
    { enabled: resolvedRegionName !== undefined }
  );

  const regionRows = regionList.map((region) => ({
    code: region.regionCode,
    name: region.name,
    // 특정된 지역 이름을 실어 숙소 목록으로 — 검색어(날문자열)가 아니라 카탈로그명(RegionPickerPage
    // purpose='stay' 선례). encodeURIComponent 는 리포 관례.
    onPress: () =>
      router.push(`/stays?region=${encodeURIComponent(region.name)}`),
  }));

  const placeCards = visiblePlaces(places.data ?? [], searchText).map(
    (place) => ({
      poiId: place.poiId,
      name: place.nameKo,
      onPress: () => router.push(`/explore/places/${place.poiId}`),
    })
  );

  // 숙소 카드는 표시 전용(onPress 없음) — `/stays/[stayId]` 라우트 부재로 상세 이동은 후속(Seed Q2).
  const stayCards = (stays.data?.items ?? []).map((item) => ({
    key: stayKey(item),
    name: item.name,
    priceText: formatPrice(item.price),
  }));

  return (
    <UnifiedSearchScreen
      searchText={searchText}
      onChangeSearch={setSearchText}
      heading={`'${searchText}' 검색 결과`}
      region={{
        error: regions.isError,
        rows: regionRows,
        onRetry: () => {
          void regions.refetch();
        },
      }}
      place={{
        error: places.isError,
        cards: placeCards,
        onRetry: () => {
          void places.refetch();
        },
      }}
      stay={{
        noRegion: resolvedRegionName === undefined,
        error: stays.isError,
        cards: stayCards,
        onRetry: () => {
          void stays.refetch();
        },
      }}
    />
  );
}
