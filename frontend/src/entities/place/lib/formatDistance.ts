/**
 * TRIP-806 · AC-M3 · INV-3 — 미터 숫자를 거리 문자열로 바꾸는 순수 코어.
 *
 * `legDistance`·`radiusUsedLabel` 이 각자 복붙하던 반올림을 한 곳으로 모았다. 접두("이동"·"약")는
 * 붙이지 않는다 — 소비처가 `` `이동 ${formatDistance(합)}` ``·`` `약 ${formatDistance(반경)}` ``으로 붙인다.
 *
 *  - `< 1000m` → 가장 가까운 10m("820m")
 *  - `>= 1000m` → 소수 1자리 km("3.2km")
 *  - 반올림은 `Math.round`(round-half-up): 825→830m, 3280→3.3km
 *
 * INV-3: 반환에 소요시간 단위(분·시간·소요)가 원리적으로 없다 — 거리만 반환한다.
 * 항상 양수 미터를 받는다(널·broken·합계 0 처리는 호출부인 `legDistance` 몫).
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    const rounded = Math.round(meters / 10) * 10;
    return `${rounded}m`;
  }
  const km = Math.round(meters / 100) / 10;
  return `${km.toFixed(1)}km`;
}
