import type { Place } from '@/shared/api/generated/schemas';

/**
 * 계약(`GET /places`)에 정렬·검색 파라미터가 없어, 화면에 그리기 전 클라 가공을 이 함수
 * 하나로 모은다(AC-7·AC-8). 이름(`nameKo`) 부분일치로 좁히고 `savedCount` 내림차순으로
 * 정렬한다 — 동점은 입력 순서를 유지한다(`Array.prototype.sort`는 안정 정렬).
 *
 * 입력 배열은 TanStack Query 캐시가 소유한 배열일 수 있어(`useGetPlaces().data`) 절대
 * 제자리 정렬하지 않는다 — 항상 새 배열을 반환한다.
 */
export function visiblePlaces(places: Place[], searchText: string): Place[] {
  const needle = searchText.trim();
  const filtered =
    needle === ''
      ? [...places]
      : places.filter((place) => place.nameKo.includes(needle));

  return filtered.sort((a, b) => b.savedCount - a.savedCount);
}
