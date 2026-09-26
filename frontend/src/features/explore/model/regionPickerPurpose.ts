/**
 * 지역 선택(`/explore/region`) purpose 철자의 단일 출처 (TRIP-985).
 *
 * 피커는 모르는 purpose 를 조용히 stay 로 떨어뜨리므로(URL 신뢰 경계), 호출자와 피커가 각자
 * 리터럴을 쓰면 오타가 나도 아무도 모른다. 그래서 호출자는 이 헬퍼로 URL 을 만들고, 피커는 이
 * 유니온으로 해석한다.
 *  - `stay`    숙소 지역 선택 → `/stays`
 *  - `trip`    위저드 "도시 추가" 전용 → 위저드에 담고 복귀(TRIP-683 AC-1)
 *  - `explore` 탐색 진입(랜딩·홈·결과 화면 검색) → 목적지 결과 화면
 *  - `places`  d04 "지역 바꾸기" → d04 지역 교체
 */
export type RegionPickerPurpose = 'stay' | 'trip' | 'explore' | 'places';

/** 반환 타입은 `string` 이 아니라 템플릿 리터럴이다 — `typedRoutes` 가 `router.push` 에서 순수 string 을 거부한다. */
export function regionPickerHref(
  purpose: RegionPickerPurpose
): `/explore/region?purpose=${RegionPickerPurpose}` {
  return `/explore/region?purpose=${purpose}`;
}
