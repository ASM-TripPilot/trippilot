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

import type { StayItem } from '@/shared/api/generated/schemas';
import { getAccessToken } from '@/shared/api/tokenManager';

import {
  filterByPriceRange,
  type PriceBucketId,
} from '@/features/stay/model/priceRangeFilter';
import { relaxCulpritFilter } from '@/features/stay/model/relaxCulpritFilter';
import { useSavedStays } from '@/features/stay/model/savedStays';
import {
  buildStayFilterOptions,
  countActiveFilters,
  toggleFilterValue,
} from '@/features/stay/model/stayFilterOptions';
import { stayKey } from '@/features/stay/model/stayKey';
import { resolveStaySearchState } from '@/features/stay/model/staySearchState';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { StayFilterSheet } from '@/features/stay/ui/StayFilterSheet';
import { StayPriceSheet } from '@/features/stay/ui/StayPriceSheet';
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

  // 가격대 시트(TRIP-457) — 계약(`/stays/search`)에 price 파라미터가 없어 서버 필터가 불가하므로
  // 응답 items 를 `priceRangeFilter` 순수 함수로 클라 파생 필터한다(01b Q4 (a)). 시트 열림·선택
  // 버킷은 이 배선이 소유(화면·시트는 useState 0건 구조 가드).
  const [priceSheetOpen, setPriceSheetOpen] = useState(false);
  const [priceBucket, setPriceBucket] = useState<PriceBucketId>('all');

  const { data, isPending, isError, refetch } = useStaySearch({
    region: resolvedRegion,
    ...(amenityList.length > 0 ? { amenity: amenityList } : {}),
    ...(stayTypeList.length > 0 ? { stayType: stayTypeList } : {}),
  });

  // 저장 하트(TRIP-417). isAuthed는 렌더 시점 1회 동기 판정(PlaceExplorePage 선례 — "판정 대기"
  // 제3 상태가 안 생긴다). 담김 목록·토글은 useSavedStays 한 곳이 소유하고, 응답 대기 키만
  // 페이지 로컬 상태로 들어 화면이 그 하트를 disabled로 만들게 한다(연타 중복 요청 차단, AC-8).
  const isAuthed = getAccessToken() !== null;
  const { isSaved, save, remove, savedKeys } = useSavedStays({ isAuthed });
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);

  async function attemptToggle(item: StayItem): Promise<void> {
    const key = stayKey(item);
    setPendingKeys((keys) => [...keys, key]);
    const outcome = isSaved(key) ? await remove(item) : await save(item);
    setPendingKeys((keys) => keys.filter((k) => k !== key));

    // 미인증 누름은 요청 없이 로그인으로 보낸다(BR-U1-03 · Q6, 죽은 버튼 회피).
    if (outcome.kind === 'failed' && outcome.reason === 'unauthenticated') {
      router.push('/(auth)/login');
    }
  }

  // 가격대 파생 필터(TRIP-457) — 기본 `all`은 순서보존 전량이라 동결 통합테스트가 무회귀다
  // (★F-6). 화면에 내리는 목록·개수(헤더 "N곳") 둘 다 이 파생 결과에서 나와 갈라지지 않는다.
  const visibleItems = filterByPriceRange(data?.items ?? [], priceBucket);

  const state = resolveStaySearchState({
    isPending,
    isError,
    itemCount: visibleItems.length,
    degraded: data?.degraded ?? false,
    filterZeroReasons: data?.filterZeroReasons ?? [],
  });

  // 필터 칩 — 지역=재선택 진입(/explore/region 재사용), 필터=시트 열기, 가격대=가격대 시트 열기
  // (TRIP-457 복구 — 이전엔 axis 를 무시해 무동작이던 결함).
  function handlePressFilter(axis: 'price' | 'region' | 'more'): void {
    if (axis === 'region') {
      router.push('/explore/region');
      return;
    }
    if (axis === 'price') {
      setPriceSheetOpen(true);
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
        items={visibleItems}
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
        // 빈 상태 카드 CTA(TRIP-416) — 화면은 라우터를 모른다(구조 가드), 배선은 이 페이지 몫.
        // 지역 바꾸기는 필터 칩과 같은 목적지(/explore/region)로 진입한다(AC-1).
        onPressChangeRegion={() => router.push('/explore/region')}
        // 필터 완화(AC-2)·초기화(AC-4) 공용 — amenity/stayType 두 키만 비운다(region 은 merge 로
        // 유지되므로 넣지 않는다, ★4). setParams 갱신 → useLocalSearchParams 갱신 → 재조회.
        onRelaxFilters={() => router.setParams({ amenity: [], stayType: [] })}
        // 원인 필터만 해제(AC-5) — relaxCulpritFilter 가 reason(=reasons[0])을 지금 적용된 두
        // 배열에 매핑해 그 원인만 뺀 {amenity, stayType}를 낸다(정확히 두 키라 그대로 넘긴다).
        onClearCulpritFilter={(reason) =>
          router.setParams(
            relaxCulpritFilter(reason, {
              amenity: amenityList,
              stayType: stayTypeList,
            })
          )
        }
        // 저장 하트(TRIP-417) — 담김 집합·대기 집합은 값으로, 누름은 콜백으로 내린다. 화면은
        // 저장/해제·라우팅을 모른다(구조 가드) — attemptToggle이 판정·요청·로그인 이동을 전담.
        savedKeys={savedKeys}
        pendingKeys={pendingKeys}
        onToggleSave={(item) => void attemptToggle(item)}
        // 카드 탭(TRIP-457 AC-5) → 상세 라우트로 push(객체형·raw stayKey·item JSON — expo-router
        // 자동 인코딩이라 수동 encode 안 함 ★F-3). 화면은 라우터를 모른다(구조 가드).
        onPressCard={(item) =>
          router.push({
            pathname: '/stays/[stayId]',
            params: { stayId: stayKey(item), item: JSON.stringify(item) },
          })
        }
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
      {priceSheetOpen ? (
        <StayPriceSheet
          selected={priceBucket}
          onSelect={setPriceBucket}
          onClose={() => setPriceSheetOpen(false)}
        />
      ) : null}
    </>
  );
}
