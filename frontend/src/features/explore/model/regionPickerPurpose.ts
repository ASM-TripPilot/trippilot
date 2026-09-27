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
 *
 * `tab`(TRIP-1015 E) — 진입 탭 컨텍스트. 결과 화면은 `(tabs)` 밖이라 어느 탭에서 왔는지 모르므로 홈 검색은
 * `tab=home` 을 싣고, 피커가 결과 화면으로 되실어 보낸다(`dismissTo` 는 파라미터를 합치지 않는다).
 * TRIP-1026 `from=wizard`(어느 흐름에서 왔나)와는 다른 축이라 키를 나눴다.
 */
export type RegionPickerPurpose = 'stay' | 'trip' | 'explore' | 'places';
export type RegionPickerTab = 'home';

/** 반환 타입은 `string` 이 아니라 템플릿 리터럴이다 — `typedRoutes` 가 `router.push` 에서 순수 string 을 거부한다. */
export function regionPickerHref(
  purpose: RegionPickerPurpose,
  opts?: { tab: RegionPickerTab }
):
  | `/explore/region?purpose=${RegionPickerPurpose}`
  | `/explore/region?purpose=${RegionPickerPurpose}&tab=${RegionPickerTab}` {
  return opts
    ? `/explore/region?purpose=${purpose}&tab=${opts.tab}`
    : `/explore/region?purpose=${purpose}`;
}
