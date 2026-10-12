import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { getEngineDeps } from './deps';
import { evaluate, handleGeofence, handleLocations } from './engine';
import { GEOFENCE_TASK, ROUTE_TASK } from './native';
import { readPermissionSnapshot } from './permission';

/**
 * TRIP-1338 · 백그라운드 태스크 정의(NFR LC-U10-2 WakeRunner). **모듈 최상위에서** 정의해야 앱이 백그라운드로
 * 깨어나 JS 번들만 로드됐을 때도 태스크가 있다. 이 파일은 플래그 ON 일 때만 평가된다
 * (`src/app/entrypoint/registerBackgroundTasks.ts`).
 *
 * React·page·feature 를 import 하지 않는다(eslint 블록이 막는다). Query 캐시도 만지지 않는다 —
 * 포그라운드 복귀 시 훅이 무효화한다. 위치 객체·좌표를 로그·Sentry 로 보내지 않는다(SEC-U10-05).
 *
 * ⚠️ 기기 검증 전 — 앱 종료 상태 wake·실제 진입/이탈 발화는 6-b #3~5·#17(jest 원리적 사각).
 */

async function reArm(): Promise<boolean> {
  const deps = getEngineDeps();
  const s = await evaluate(deps, {
    flagOn: true,
    snapshot: await readPermissionSnapshot(),
    onHub: false,
  });
  return s.state === 'ARMED';
}

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { eventType, region } = data as {
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  };
  if (!region?.identifier) return;
  try {
    if (!(await reArm())) return;
    await handleGeofence(getEngineDeps(), {
      slotKey: region.identifier,
      type: eventType === Location.GeofencingEventType.Enter ? 'enter' : 'exit',
    });
  } catch {
    // 사유 없는 침묵이 아니다 — 다음 포그라운드 복귀에서 훅이 무장을 다시 계산하고 큐를 flush 한다.
  }
});

TaskManager.defineTask(ROUTE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations?.length) return;
  try {
    await handleLocations(
      getEngineDeps(),
      locations.map((l) => ({
        t: l.timestamp,
        lat: l.coords.latitude,
        lng: l.coords.longitude,
        acc: l.coords.accuracy ?? Number.POSITIVE_INFINITY,
      }))
    );
  } catch {
    // 위와 같음 — 표본은 다음 일괄 전달에서 다시 온다.
  }
});
