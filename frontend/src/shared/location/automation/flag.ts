import Constants from 'expo-constants';

/**
 * TRIP-1337 · U10 위치 자동화 기능 플래그(빌드 값). 원천은 app.config.ts 의 `TRIPPILOT_LOCATION_AUTOMATION`,
 * JS 는 `extra.locationAutomation` 한 곳에서만 읽는다 — 네이티브 권한 표면과 JS 동작이 같은 값이 된다(G-U10-6).
 */
export function isLocationAutomationEnabled(): boolean {
  return Constants.expoConfig?.extra?.locationAutomation === true;
}
