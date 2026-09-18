import fc from 'fast-check';

import { ArriveRequestSource } from '@/shared/api/generated/schemas';
import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import {
  buildGeofenceRegions,
  clearGeofences,
  geofenceArriveRequest,
  registerGeofences,
  type GeofenceRegion,
} from './geofence';

/**
 * TRIP-396 · AC-7 (BR-U4-36) — 지오펜스(예정 좌표 "울타리") 계약 + 순수 매핑.
 *
 * 무엇을 보장하나(부분만 — 네이티브 발화는 이번 범위 밖, 02a ★7):
 *  - `geofenceArriveRequest(region)` = 진입 이벤트를 도착 요청으로 바꾸는 **경계(순수 매핑)** —
 *    항상 `source: AUTO_GEOFENCE`(수동 체크인과 갈리는 라벨), slotKey·poiId 보존.
 *  - `buildGeofenceRegions(slots, date)` = 좌표가 있는 슬롯만 리전으로(결측 좌표는 제외).
 *  - `registerGeofences`/`clearGeofences` = 등록/해제 계약. 이번 빌드는 네이티브(expo-task-manager·
 *    background 권한·리빌드) 미배선이라 **정직한 degrade 스텁**(armed:false, 무throw) — 거짓
 *    발화를 만들지 않는다(`useActualRoute` 선례).
 *
 * 3동작 뼈대: 준비=리전/슬롯 → 실행=매핑·도출·등록 → 단언=source/좌표/armed.
 */

const region = (over: Partial<GeofenceRegion> = {}): GeofenceRegion => ({
  slotKey: '2026-08-20#p1',
  poiId: 'p1',
  lat: 35.1,
  lng: 129.1,
  radiusM: 120,
  ...over,
});

const slot = (
  over: Partial<ItineraryDaysItemSlotsItem> &
    Pick<ItineraryDaysItemSlotsItem, 'poiId'>
): ItineraryDaysItemSlotsItem => ({
  startAt: '13:00:00',
  endAt: '14:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  nameKo: null,
  lat: 35.1,
  lng: 129.1,
  distanceRange: null,
  openingHours: null,
  tags: [],
  ...over,
});

describe('geofence (AC-7)', () => {
  it('GF1 진입 → 도착 요청 순수 매핑: source 는 항상 AUTO_GEOFENCE', () => {
    expect(geofenceArriveRequest(region())).toEqual({
      slotKey: '2026-08-20#p1',
      poiId: 'p1',
      source: ArriveRequestSource.AUTO_GEOFENCE,
    });
  });

  it('GF2 리전 도출: 좌표 없는 슬롯은 제외, slotKey 는 {date}#{poiId}', () => {
    const regions = buildGeofenceRegions(
      [
        slot({ poiId: 'p1', lat: 35.1, lng: 129.1 }),
        slot({ poiId: 'p2', lat: 35.2, lng: 129.2 }),
        slot({ poiId: 'p3', lat: null, lng: null }), // 좌표 결측 → 울타리 못 침
      ],
      '2026-08-20'
    );

    expect(regions).toHaveLength(2);
    expect(regions.map((r) => r.poiId)).toEqual(['p1', 'p2']);
    expect(regions[0].slotKey).toBe('2026-08-20#p1');
    expect(regions[0].lat).toBe(35.1);
    expect(regions[0].lng).toBe(129.1);
    // 반경 값은 정본 침묵 → 발명하지 않고 "양수" 구조만 잠근다(categoryPlaceholder 선례).
    expect(regions[0].radiusM).toBeGreaterThan(0);
  });

  it('GF3 등록은 네이티브 미배선이라 armed:false 로 정직하게 degrade 한다 (무throw)', () => {
    const result = registerGeofences([region()]);
    expect(result.armed).toBe(false);
  });

  it('GF4 해제는 무해하다 (무throw)', () => {
    expect(() => clearGeofences()).not.toThrow();
  });

  it('GF5 (PBT) 어떤 리전이든 매핑은 source 를 AUTO_GEOFENCE 로 고정하고 키를 보존한다', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (slotKey, poiId, lat, lng) => {
          const req = geofenceArriveRequest(
            region({ slotKey, poiId, lat, lng })
          );
          expect(req.source).toBe(ArriveRequestSource.AUTO_GEOFENCE);
          expect(req.slotKey).toBe(slotKey);
          expect(req.poiId).toBe(poiId);
        }
      ),
      { numRuns: 300 }
    );
  });
});
