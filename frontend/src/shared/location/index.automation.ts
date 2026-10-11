// TRIP-1338 · 앱 엔트리 전용 진입점 — 플래그 판독과 백그라운드 태스크 적재만 싣는다(화면·훅·네트워크를 끌지 않는다).
// 태스크 파일은 `loadBackgroundTasks()` 를 부를 때만 평가된다(플래그 OFF 빌드에서는 불리지 않는다).
export { isLocationAutomationEnabled } from './automation/flag';

export function loadBackgroundTasks(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./automation/tasks');
}
