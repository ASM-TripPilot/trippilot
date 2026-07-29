/**
 * 숙소 검색 결과 배선(US-STAY-01 · 01b Seed Q2·Q5·Q8). `useLocalSearchParams`의 `region`
 * (없으면 `'부산'` 폴백)·`amenity`·`stayType`으로 `useStaySearch`를 호출하고, 응답과
 * `useQuery` 상태를 `resolveStaySearchState`에 넘겨 판별 유니온 하나로 접어 `StaySearchScreen`에
 * 내린다 — 상태 판정은 이 파일만 한다(화면은 다시 판정하지 않는다, AC-8 단일 출처). `다시
 * 시도`는 같은 쿼리의 `refetch`를 그대로 물린다(Q8, 스텁이 아니라 실배선).
 */
import type { ReactElement } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { resolveStaySearchState } from '@/features/stay/model/staySearchState';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
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

  return (
    <StaySearchScreen
      region={resolvedRegion}
      items={data?.items ?? []}
      state={state}
      // 화살표로 감싼다(03b N-3) — `onRetry={refetch}`면 RN이 `onPress(누름이벤트)`로
      // 불러 그 이벤트가 `refetch`의 옵션 인자 자리로 밀려든다. 여기서 인자를 끊으면
      // 그 아래 어떤 Pressable을 거치든 `refetch()`가 항상 무인자로 불린다.
      onRetry={() => refetch()}
    />
  );
}
