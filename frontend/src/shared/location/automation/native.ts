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
}

export const nativeAdapters: NativeAdapters = {
  async armGeofences(regions) {
    try {
      if (regions.length === 0) {
        await this.disarmGeofences();
        return { armed: true, reason: 'no-regions' };
      }
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
      return { armed: true };
    } catch {
      return { armed: false, reason: 'native-register-failed' };
    }
  },
  async disarmGeofences() {
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
