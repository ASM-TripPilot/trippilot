import type { Place } from '../model';

/**
 * TRIP-1049 — 홈 '지금 뜨는 장소': `savedCount` 내림차순 앞 `count`곳(u1 FD F-2 클라 정렬 선례).
 * 동점은 입력(서버=이름순) 순서를 지킨다 — `Array.prototype.sort` 는 안정 정렬이다(ES2019).
 * 입력은 복사해서 정렬한다(react-query 캐시 배열을 제자리 정렬하지 않게).
 *
 * ponytail: 서버가 준 한 페이지(최대 200곳) 안에서만의 인기순 — 서버에 `sort=saved` 가 생기면
 * 이 함수 대신 그 파라미터를 쓴다.
 */
export function pickTrendingPlaces(
  places: readonly Place[],
  count: number
): Place[] {
  return [...places]
    .sort((a, b) => b.savedCount - a.savedCount)
    .slice(0, count);
}
