/**
 * 숙소 검색 결과 배선 (US-STAY-01 · 01b Seed Q8). `useLocalSearchParams`의 `region`(없으면
 * `'부산'` 폴백 — 지역 선택 진입 화면 TRIP-183이 아직 없다)으로 `useStaySearch`를 호출해
 * `StaySearchScreen`에 props로 내린다. `useQuery`는 첫 렌더에 `data`가 `undefined`라
 * `data?.items ?? []`로 방어한다.
 */
import type { ReactElement } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { StaySearchScreen } from '@/features/stay/ui/StaySearchScreen';

export function StaySearchPage(): ReactElement {
  const { region } = useLocalSearchParams<{ region?: string }>();
  // URL은 신뢰 경계 — 같은 쿼리 키가 중복되면 배열로 온다(Array.isArray 방어), 빈 문자열도
  // '없음'으로 본다(formatPrice의 `== null`과 반대 방향 — 거긴 0을 살리지만 여긴 ''를 죽인다).
  const rawRegion = Array.isArray(region) ? region[0] : region;
  const resolvedRegion = rawRegion || '부산';
  const { data } = useStaySearch({ region: resolvedRegion });

  return <StaySearchScreen region={resolvedRegion} items={data?.items ?? []} />;
}
