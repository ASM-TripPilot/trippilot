import * as Location from 'expo-location';

import type { GeofenceRegion } from '../geofence';
import { AUTOMATION_CONFIG } from './config';

/**
 * TRIP-1338 · 네이티브 어댑터 (FD §2.2 nativeGeofence/nativeRoute · NFR LC-U10-6).
 *
 * ⚠️ 기기 검증 전 — 실제 OS 등록·wake·상태바 위치 표시는 jest 가 원리적으로 못 본다(G-U10-14, 6-b #3·#6).
 * 계약: 실패는 throw 하지 않고 `{armed:false, reason}` 같은 모양으로 돌려준다(스텁 계약 승계 — 등록 실패 = MANUAL).
 * 해제(stop*)는 "등록 안 됨" 예외를 삼킨다(멱등).
 */

export const GEOFENCE_TASK = 'trippilot-u10-geofence';
export const ROUTE_TASK = 'trippilot-u10-route';

export interface NativeAdapters {
  armGeofences(
    regions: readonly GeofenceRegion[]
  ): Promise<{ armed: boolean; reason?: string }>;
  disarmGeofences(): Promise<void>;
  startRouteRecording(): Promise<{ recording: boolean; reason?: string }>;
  stopRouteRecording(): Promise<void>;
  /** TRIP-1511 · 등록 기억만 비운다(OS 호출 없음) — 포그라운드 복귀에서 OS 가 잃은 등록을 한 번 되살리게. */
  forgetArmedRegions?(): void;
}

/**
 * TRIP-1511 · 마지막으로 OS 에 등록한 리전 집합. iOS 는 재등록 직후 리전 상태를 통지하고 expo 가 그것을
 * 같은 지오펜스 태스크로 보내는데, 그 태스크가 다시 무장하면 무한 루프가 된다 — 같은 집합이면 OS 를 부르지 않는다.
 * 모듈 기억이라 콜드 wake 엔 비어 있어 한 번은 다시 등록한다(그 뒤 통지로 온 태스크는 생략된다).
 */
let armedKey: string | null = null;

const regionsKey = (regions: readonly GeofenceRegion[]) =>
  regions
    .map((r) => `${r.slotKey}|${r.lat}|${r.lng}|${r.radiusM}`)
    .sort()
    .join(';');

export const nativeAdapters: NativeAdapters = {
  async armGeofences(regions) {
    try {
      if (regions.length === 0) {
        await this.disarmGeofences();
        return { armed: true, reason: 'no-regions' };
      }
      const key = regionsKey(regions);
      if (key === armedKey) return { armed: true };
      await Location.startGeofencingAsync(
        GEOFENCE_TASK,
        regions.map((r) => ({
          identifier: r.slotKey,
          latitude: r.lat,
          longitude: r.lng,
          radius: r.radiusM,
          notifyOnEnter: true,
          notifyOnExit: true,
        }))
      );
      armedKey = key;
      return { armed: true };
    } catch {
      return { armed: false, reason: 'native-register-failed' };
    }
  },
  forgetArmedRegions() {
    armedKey = null;
  },
  async disarmGeofences() {
    armedKey = null;
    try {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    } catch {
      // 등록 안 됨 — 멱등
    }
  },
  async startRouteRecording() {
    try {
      const r = AUTOMATION_CONFIG.recording;
      // 같은 옵션으로 다시 불러도 된다 — OS 가 멈춘 기록을 wake 마다 재개한다(P-BG-U10-4).
      await Location.startLocationUpdatesAsync(ROUTE_TASK, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: r.distanceIntervalM,
        deferredUpdatesInterval: r.deferredUpdatesIntervalMs,
        deferredUpdatesDistance: r.deferredUpdatesDistanceM,
        pausesUpdatesAutomatically: true,
        // 상태바 위치 표시를 숨기지 않는다(BR-U10-08).
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'TripPilot 여행 기록',
          notificationBody: '여행 날짜 동안 방문과 이동 경로를 기록하고 있어요',
        },
      });
      return { recording: true };
    } catch {
      return { recording: false, reason: 'native-route-failed' };
    }
  },
  async stopRouteRecording() {
    try {
      await Location.stopLocationUpdatesAsync(ROUTE_TASK);
    } catch {
      // 시작 안 됨 — 멱등
    }
  },
};
