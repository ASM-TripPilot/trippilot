import { UnifiedSearchPage } from '@/pages/unified-search';

/**
 * d05 통합 검색 라우트 — `@/pages/unified-search` 배럴을 경유하는 얇은 래퍼(`region.tsx` 선례,
 * 훅·마크업 0). d01 검색창 탭이 여기로 오고(TRIP-450), 검색어는 페이지가 `useLocalSearchParams`
 * 또는 searchBar 입력으로 받는다.
 */
export default function UnifiedSearchRoute() {
  return <UnifiedSearchPage />;
}
