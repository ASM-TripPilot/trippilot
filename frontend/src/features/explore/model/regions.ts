/**
 * 지역 카탈로그 — e00(숙소 지역 선택)·d1b(여행지 선택) 공용 (TRIP-445).
 *
 * 하드코딩 상수 6개(구 `REGIONS`)를 서버 카탈로그 `GET /regions` 로 교체했다. 세 가지를 노출한다:
 *  · `useRegions()` — `GET /regions` 조회 훅(q 없이 전체 카탈로그 한 번). 두 소비처(지역선택
 *    페이지·여행 위저드 페이지)가 무는 단일 목 seam(`useStaySearch`/`useSavedStays` 선례).
 *  · `filterRegions(list, query)` — 서버가 준 목록을 클라이언트에서 좁힌다(D1). q 서버 파라미터
 *    대신 클라 필터라 위저드 confirm 이 full 목록에서 되찾는 TRIP-387 성질과 결이 같다.
 *  · `regionTint(regionCode)` — 임의 서버 코드('51720' 같은 숫자문자열)를 결정적으로 해시해
 *    그라데이션 색 쌍을 고른다. 닫힌 6코드 Record 가 임의 코드에 구조적으로 파손되던 것의 대체.
 *
 * 서버 `Region` shape 은 `@/shared/api/generated/schemas` 가 정본이다 — 여기서 재선언하지 않는다.
 */

import type { GetRegionsParams, Region } from '@/shared/api/generated/schemas';

/**
 * `GET /regions` 조회 훅. 생성 훅 `useGetRegions(params?)` 얇은 재수출이다.
 *
 * `params` 는 additive(TRIP-450 d05 통합 검색이 `{ q: 검색어 }` 로 서버 별칭 매칭을 쓴다) —
 * 미지정이면 기존 호출(`useRegions()`, 전체 카탈로그)과 같다(무회귀).
 *
 * ⚠️ `useGetRegions` 를 정적 import 하지 않고 **호출 시점 require** 로 미룬다: 정적이면 이
 * 모듈이 네트워크 계층(`@/shared/api`)을 전이 의존으로 끌고, `regionTint` 를 import 하는
 * 프레젠테이션 화면(`RegionPickerScreen`)까지 그것을 물게 된다 — 그 화면을 정적으로 그리는
 * `devPreview` 계열 동결 테스트의 지뢰 목이 준비 단계에서 터진다. 이 훅은 배선 층(page)에서만
 * 불리고 프리뷰는 화면만 그리므로, 로드를 호출 시점까지 미루면 그 전이 경로가 끊긴다.
 */
export function useRegions(params?: GetRegionsParams) {
  type Places = typeof import('@/shared/api/generated/places/places');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const places: Places = require('@/shared/api/generated/places/places');
  // 반환 타입은 `useStaySearch` 선례처럼 추론에 맡긴다 — 호출이 기본 제네릭 인자를 적용해
  // `data: Region[] | undefined`가 된다(`ReturnType<typeof …>`는 제약을 써 `{}`로 무너진다).
  return places.useGetRegions(params);
}

/**
 * 검색어로 지역을 좁힌다 — 서버가 준 목록을 인자로 받는다(상수가 사라져 시그니처가 바뀌었다).
 *
 * 빈 질의(공백만 포함)는 목록 전체를 그대로 돌려준다 — "입력하지 않음"과 "일치 없음"은 다르다.
 * 일치가 없으면 빈 배열이다. 여기서 전체로 되돌리면 사용자에겐 필터가 고장난 것으로 보인다.
 * 순서는 보존한다(서버가 시도→층→이름 순으로 정렬해 주고, 화면은 재정렬하지 않는다).
 */
export function filterRegions(
  regions: readonly Region[],
  query: string
): readonly Region[] {
  const needle = query.trim();
  if (needle === '') return regions;
  return regions.filter((region) => region.name.includes(needle));
}

/**
 * 검색어가 비어 있으면 앞쪽 소수(인기 지역 등)만, 입력이 있으면 목록 전체를 그대로 준다
 * (TRIP-469). 서버가 카탈로그를 인기·대표 순으로 정렬해 주므로 앞 `limit` 개가 곧 대표 지역이다
 * — 빈 질의에 서울 25개 구까지 전부 쏟아내던 것을 소수로 좁히는 자리. 순서는 보존한다.
 */
export function limitRegionsWhenEmpty(
  regions: readonly Region[],
  query: string,
  limit = 6
): readonly Region[] {
  return query.trim() === '' ? regions.slice(0, limit) : regions;
}

/**
 * 지역 사진 자리 — 리포에 이미지 에셋이 0건이라(실측) 그라데이션으로 대체한다. 사진이 들어오면
 * 이 팔레트를 지우고 <Image> 로 바꾼다. 색은 이 파일 안에서만 raw hex 로 고정한다
 * (`regionTint` 반환은 LinearGradient `colors` 가 요구하는 hex 문자열이라 className 불가).
 */
const TINT_PALETTE: readonly (readonly [string, string])[] = [
  ['#4A90D9', '#2B5F9E'],
  ['#C98A3E', '#8A5A22'],
  ['#6E7B8B', '#3F4A57'],
  ['#4FA97F', '#2C7355'],
  ['#5C8FA8', '#33606F'],
  ['#7A6BB5', '#4A3E7A'],
];

/** `regionCode` 문자열을 결정적 정수로 접는다 — 같은 코드는 항상 같은 팔레트 자리를 고른다. */
function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * 임의 `regionCode` → 그라데이션 색 쌍. 결정적이고(같은 코드=같은 색), 어떤 문자열에도 안전하다
 * (닫힌 Record 가 아니라 해시라 서버가 주는 수십~수백 코드를 전부 받는다).
 */
export function regionTint(regionCode: string): readonly [string, string] {
  return TINT_PALETTE[hashCode(regionCode) % TINT_PALETTE.length];
}
