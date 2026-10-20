import {
  installHttpAutomationSink,
  isLocationAutomationEnabled,
  loadBackgroundTasks,
} from '@/shared/location/index.automation';

/**
 * TRIP-1338 · U10 백그라운드 태스크 등록(NFR LC-U10-1). 앱 JS 평가의 첫 줄(리포 루트 `index.ts`)에서 부른다 —
 * 백그라운드 wake 로 JS 번들만 로드돼도 태스크 정의가 있어야 한다.
 * 플래그 OFF 빌드에서는 태스크 파일을 **평가하지 않는다**(BR-U10-07).
 * TRIP-1485 · 태스크 적재와 한 쌍으로 실 http 싱크를 꽂는다 — 백그라운드 wake 에서도 가짜 싱크로 새지 않게.
 */
export function registerBackgroundTasks(): boolean {
  if (!isLocationAutomationEnabled()) return false;
  loadBackgroundTasks();
  installHttpAutomationSink();
  return true;
}
