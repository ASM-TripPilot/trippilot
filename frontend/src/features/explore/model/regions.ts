/**
 * 지역 목록 — e00(숙소 지역 선택)·d1b(여행지 선택) 공용 상수.
 *
 * **왜 서버가 아니라 상수인가**: `GET /regions` 계약이 없다(`frontend-components.md` §2가
 * `⚠️ 계약 미존재`로 표기). 백엔드 콘텐츠도 `StubJejuContentAdapter`의 제주 고정 5곳이라
 * 지금 엔드포인트를 만들어도 반환값이 `["제주"]` 하나뿐이다 — 실 벤더 어댑터가 붙어
 * 선택할 지역이 둘 이상 생길 때 이 상수를 서버 응답으로 교체한다.
 *
 * 값은 Figma e00 `1836:2283` · d1b `1834:2283` 실측 그대로(두 화면의 지역 6개가 동일하다).
 */

export type RegionCode =
  'busan' | 'gyeongju' | 'seoul' | 'jeju' | 'gangneung' | 'yeosu';

export interface Region {
  /** testID·라우팅 파라미터용 안정 식별자. 한글을 쓰면 셀렉터가 취약해진다. */
  code: RegionCode;
  /** 표시 라벨이자 **서버 질의값** — `GET /stays/search?region=` 은 자유 문자열 계약이다. */
  name: string;
}

export const REGIONS: readonly Region[] = [
  { code: 'busan', name: '부산' },
  { code: 'gyeongju', name: '경주' },
  { code: 'seoul', name: '서울' },
  { code: 'jeju', name: '제주' },
  { code: 'gangneung', name: '강릉' },
  { code: 'yeosu', name: '여수' },
];

/**
 * 검색어로 지역을 좁힌다. 상수 목록이라 서버 없이 성립한다.
 *
 * 빈 질의(공백만 포함)는 전체를 돌려준다 — "입력하지 않음"과 "일치 없음"은 다르다.
 * 일치가 없으면 빈 배열이다. 여기서 전체로 되돌리면 사용자에겐 필터가 고장난 것으로 보인다.
 */
export function filterRegions(query: string): readonly Region[] {
  const needle = query.trim();
  if (needle === '') return REGIONS;
  return REGIONS.filter((region) => region.name.includes(needle));
}
