/**
 * 숙소 검색 결과 배선(US-STAY-01 · 01b Seed Q2·Q5·Q8). `useLocalSearchParams`의 `region`
 * (없으면 `'부산'` 폴백)·`amenity`·`stayType`으로 `useStaySearch`를 호출하고, 응답과
 * `useQuery` 상태를 `resolveStaySearchState`에 넘겨 판별 유니온 하나로 접어 `StaySearchScreen`에
 * 내린다 — 상태 판정은 이 파일만 한다(화면은 다시 판정하지 않는다, AC-8 단일 출처). `다시
 * 시도`는 같은 쿼리의 `refetch`를 그대로 물린다(Q8, 스텁이 아니라 실배선).
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import {
  buildStayFilterOptions,
  countActiveFilters,
  toggleFilterValue,
} from '@/features/stay/model/stayFilterOptions';
import { resolveStaySearchState } from '@/features/stay/model/staySearchState';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { StayFilterSheet } from '@/features/stay/ui/StayFilterSheet';
import { StaySearchScreen } from '@/features/stay/ui/StaySearchScreen';

/** URL은 신뢰 경계 — 같은 쿼리 키가 중복되면 배열로 온다. 계약(`GetStaysSearchParams`)은
 * `amenity`·`stayType` 둘 다 `string[]`이므로 단일 문자열은 배열로 감싼다. 빈 값은 파라미터
 * 자체를 만들지 않는다 — 빈 배열을 보내면 서버가 "필터 있음"으로 오해할 수 있다(§6 함정 5). */
function toParamList(value?: string | string[]): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function StaySearchPage(): ReactElement {
  const { region, amenity, stayType } = useLocalSearchParams<{
    region?: string;
    amenity?: string | string[];
    stayType?: string | string[];
  }>();
  const rawRegion = Array.isArray(region) ? region[0] : region;
  const resolvedRegion = rawRegion || '부산';
  const amenityList = toParamList(amenity);
  const stayTypeList = toParamList(stayType);

  // 필터 시트 상태·선택 초안은 화면이 아니라 이 배선이 진다(features/stay/ui 는 useState 0건
  // 구조 가드, TRIP-415). 초안은 시트를 열 때 현재 적용값(params)에서 시드한다.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftAmenity, setDraftAmenity] = useState<string[]>([]);
  const [draftStayType, setDraftStayType] = useState<string[]>([]);

  const { data, isPending, isError, refetch } = useStaySearch({
    region: resolvedRegion,
    ...(amenityList.length > 0 ? { amenity: amenityList } : {}),
    ...(stayTypeList.length > 0 ? { stayType: stayTypeList } : {}),
  });

  const state = resolveStaySearchState({
    isPending,
    isError,
    // `data?.items ?? []` 아래와 방어 수준을 맞춘다(03b W-3) — `items`가 계약과 달리
    // 없는 응답이 와도 `.length`에서 TypeError로 죽지 않고 0건으로 접는다(INV-4).
    itemCount: data?.items?.length ?? 0,
    degraded: data?.degraded ?? false,
    filterZeroReasons: data?.filterZeroReasons ?? [],
  });

  // 필터 칩(TRIP-415) — 지역=재선택 진입(/explore/region 재사용, 새 UI 안 만듦), 필터=시트 열기,
  // 가격대=스텁(계약 파라미터 부재, 범위 밖이라 axis 를 무시한다).
  function handlePressFilter(axis: 'price' | 'region' | 'more'): void {
    if (axis === 'region') {
      router.push('/explore/region');
      return;
    }
    if (axis === 'more') {
      setDraftAmenity(amenityList);
      setDraftStayType(stayTypeList);
      setSheetOpen(true);
    }
  }

  // 적용 = 고른 조건을 URL params 로 밀어 넣는다 → useLocalSearchParams 갱신 → 재조회.
  function handleApplyFilter(): void {
    router.setParams({ amenity: draftAmenity, stayType: draftStayType });
    setSheetOpen(false);
  }

  const filterOptions = buildStayFilterOptions(
    data?.items ?? [],
    draftAmenity,
    draftStayType
  );

  return (
    <>
      <StaySearchScreen
        region={resolvedRegion}
        items={data?.items ?? []}
        state={state}
        // 화살표로 감싼다(03b N-3) — `onRetry={refetch}`면 RN이 `onPress(누름이벤트)`로
        // 불러 그 이벤트가 `refetch`의 옵션 인자 자리로 밀려든다. 여기서 인자를 끊으면
        // 그 아래 어떤 Pressable을 거치든 `refetch()`가 항상 무인자로 불린다.
        onRetry={() => refetch()}
        // 01b Seed §3-6 — e02의 등록 유도 버튼이 e05로 가는 문이 된다. 화면은 라우트를 모른다
        // (구조 가드, `onPressRegister` prop만 받는다) — 배선은 이 페이지 몫이다.
        // `useRouter()` 훅이 아니라 정적 `router` 싱글턴을 쓴다 — 동결 통합테스트 2건의
        // `expo-router` 목이 `useLocalSearchParams`만 제공해, 훅을 렌더 시점에 부르면 즉시
        // 깨진다(실측, 03_implementer_notes.md). `router.push`는 실제로 눌렸을 때만 평가된다.
        onPressRegister={() => router.push('/stays/register')}
        onPressBack={() => router.back()}
        // 하단 탭바(TRIP-413) — /stays 는 (tabs) 밖 라우트라 진짜 탭바가 없어 화면이 복제본을
        // 그린다. 그 복제 탭바를 실 라우팅에 잇는다: 탭 key → 해당 탭 URL 로 replace(이 스택
        // 화면을 떠나 탭으로 간다). home 만 파일 규약상 index 라 '/' 다((tabs)/_layout 매핑과 동형).
        onPressTab={(key) => router.replace(key === 'home' ? '/' : `/${key}`)}
        // FAB "여행 만들기"(TRIP-414) — 탐색 랜딩 bridge CTA·PlaceExplore CtaBar 와 같은 목적지.
        onPressCreateTrip={() => router.push('/trips/new/step1')}
        // 지역·필터 칩(TRIP-415) — 배지는 적용된 필터 개수(초안 아님).
        onPressFilter={handlePressFilter}
        activeFilterCount={countActiveFilters(amenityList, stayTypeList)}
      />
      {sheetOpen ? (
        <StayFilterSheet
          amenities={filterOptions.amenities}
          stayTypes={filterOptions.stayTypes}
          onToggleAmenity={(v) =>
            setDraftAmenity((prev) => toggleFilterValue(prev, v))
          }
          onToggleStayType={(v) =>
            setDraftStayType((prev) => toggleFilterValue(prev, v))
          }
          onApply={handleApplyFilter}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </>
  );
}
