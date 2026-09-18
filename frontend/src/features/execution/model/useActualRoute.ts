import type { GeoPoint } from './actualDistance';

/**
 * TRIP-397 · useActualRoute — 실제 이동 경로 점열 + 위치 동의(frontend-components.md §3 · DEC-U4-7).
 *
 * 실제 경로는 **앱을 켜 둔 포그라운드 구간만** GPS 점을 모은다. 그 수집은 네이티브(expo-location
 * 포그라운드 워치)라 이 substrate 에서는 아직 배선하지 않는다 — 기본은 **동의 없음·점 0**이다.
 * 그러면 `resolveActualRoute` 가 실제 경로 레이어를 비활성으로 두고 계획 동선만 보인다(BR-U4-42).
 *
 * ponytail: 네이티브 위치 워치·권한 승격을 붙일 자리. 붙기 전까지 화면은 "실제 기록 없음" 상태로
 * 정직하게 degrade 한다(거짓 경로를 그리지 않는다).
 */
export function useActualRoute(): {
  locationConsent: boolean;
  points: GeoPoint[];
} {
  return { locationConsent: false, points: [] };
}
