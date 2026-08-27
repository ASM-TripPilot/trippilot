import { ArriveRequestSource } from '@/shared/api/generated/schemas';
import type {
  ArriveRequest,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-396 · AC-7 (BR-U4-36) — 지오펜스(예정 좌표 "울타리") 계약 + 순수 매핑.
 *
 * 지오펜스 = 지도 위 좌표+반경을 OS 에 등록해, 기기가 그 안으로 들어가면 앱을 깨워 자동 도착을
 * 기록하는 기능. 여기서 검증 가능한 것은 **경계(순수 매핑)** 까지다:
 *  - `geofenceArriveRequest(region)` = 진입 이벤트 → 도착 요청. source 는 항상 AUTO_GEOFENCE
 *    (수동 체크인 MANUAL 과 갈리는 라벨), slotKey·poiId 보존.
 *  - `buildGeofenceRegions(slots, date)` = 좌표가 있는 슬롯만 리전으로(결측 좌표는 울타리 못 침).
 *
 * ⚠️ 실제 네이티브 발화(startGeofencingAsync)는 이번 범위 밖 — degrade 스텁으로 정직하게 남긴다.
 * `useActualRoute.ts`(TRIP-397)가 네이티브 미배선 자리를 armed:false 로 남긴 선례와 동형.
 */

export interface GeofenceRegion {
  slotKey: string;
  poiId: string;
  lat: number;
  lng: number;
  radiusM: number;
}

// 정본에 반경 값이 없다 — 발명하지 않고 "양수" 계약만 세운다(categoryPlaceholder 선례).
// 승격 시 정확도·POI 밀도에 맞춰 조정할 자리.
const DEFAULT_RADIUS_M = 120;

export function buildGeofenceRegions(
  slots: readonly ItineraryDaysItemSlotsItem[],
  date: string
): GeofenceRegion[] {
  const regions: GeofenceRegion[] = [];
  for (const slot of slots) {
    if (slot.lat == null || slot.lng == null) continue;
    regions.push({
      slotKey: `${date}#${slot.poiId}`,
      poiId: slot.poiId,
      lat: slot.lat,
      lng: slot.lng,
      radiusM: DEFAULT_RADIUS_M,
    });
  }
  return regions;
}

export function geofenceArriveRequest(region: GeofenceRegion): ArriveRequest {
  return {
    slotKey: region.slotKey,
    poiId: region.poiId,
    source: ArriveRequestSource.AUTO_GEOFENCE,
  };
}

export function registerGeofences(regions: GeofenceRegion[]): {
  armed: boolean;
  reason?: string;
} {
  // ponytail: 네이티브 발화 미배선 — expo-task-manager 미설치·"항상 허용"(background) 위치 권한
  // 미설정·네이티브 리빌드 선행. 붙기 전까지 armed:false 로 정직하게 degrade(거짓 발화를 안 만든다).
  // 승격 시 이 자리에서 regions 를 Location.startGeofencingAsync 로 OS 에 등록한다.
  void regions;
  return { armed: false, reason: 'native-geofencing-not-wired' };
}

export function clearGeofences(): void {
  // ponytail: 위와 짝 — 네이티브 미배선이라 해제할 실 지오펜스가 없다(무해 no-op). 승격 시
  // Location.stopGeofencingAsync 를 여기에 배선한다.
}
