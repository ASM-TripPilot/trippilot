/**
 * 상태 판정 순수 함수(01b Seed Q2·Q3·Q11 · AC-1 PBT 대상). 네트워크·렌더링 없이 입력 5개로
 * 5종 결과 중 정확히 하나를 결정한다. 우선순위: loading > error > results(1건 이상) >
 * filter-zero(0건 + 검색어·카테고리 중 하나 이상) > empty(그 외). `resolveStaySearchState`
 * (features/stay/model/staySearchState.ts)와 같은 모양이다 — 이 화면은 `degraded`가 없고
 * (담기 집계는 별도 배너로 다룬다), filter-zero는 사유 문자열 배열 대신 `blame`(검색어냐
 * 카테고리냐) 하나만 나른다. 실제 문구에 들어갈 텍스트(검색어·카테고리명)는 화면이 이미
 * `searchText`·`selectedCategory` prop으로 갖고 있어, 상태가 그 값을 복제할 필요가 없다.
 */
export type PlaceListState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'results' }
  | { kind: 'filter-zero'; blame: 'search' | 'category' }
  | { kind: 'empty' };

export function resolvePlaceListState(input: {
  isPending: boolean;
  isError: boolean;
  itemCount: number;
  hasQuery: boolean;
  hasCategory: boolean;
}): PlaceListState {
  const { isPending, isError, itemCount, hasQuery, hasCategory } = input;

  if (isPending) return { kind: 'loading' };
  if (isError) return { kind: 'error' };
  if (itemCount >= 1) return { kind: 'results' };
  // 01b Seed Q3 ⓐ — 검색어가 마지막에 적용된 필터이고 되돌리기 비용이 낮아 먼저 지목한다.
  if (hasQuery) return { kind: 'filter-zero', blame: 'search' };
  if (hasCategory) return { kind: 'filter-zero', blame: 'category' };
  return { kind: 'empty' };
}
