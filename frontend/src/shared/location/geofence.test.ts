import fc from 'fast-check';

import { ArriveRequestSource } from '@/shared/api/generated/schemas';
import type {
  ItineraryDaysItemSlotsItem,
  VisitCheck,
} from '@/shared/api/generated/schemas';

import {
  buildGeofenceRegions,
  clearGeofences,
  geofenceArriveRequest,
  registerGeofences,
  selectRegions,
  type GeofenceRegion,
} from './geofence';
import { AUTOMATION_CONFIG } from './automation/config';

/**
 * TRIP-396 · AC-7 (BR-U4-36) — 지오펜스(예정 좌표 "울타리") 계약 + 순수 매핑.
 *
 * 무엇을 보장하나(부분만 — 네이티브 발화는 이번 범위 밖, 02a ★7):
 *  - `geofenceArriveRequest(region)` = 진입 이벤트를 도착 요청으로 바꾸는 **경계(순수 매핑)** —
 *    항상 `source: AUTO_GEOFENCE`(수동 체크인과 갈리는 라벨), slotKey·poiId 보존.
 *  - `buildGeofenceRegions(slots, date)` = 좌표가 있는 슬롯만 리전으로(결측 좌표는 제외).
 *  - `registerGeofences`/`clearGeofences` = 등록/해제 계약. 이번 빌드는 네이티브(expo-task-manager·
 *    background 권한·리빌드) 미배선이라 **정직한 degrade 스텁**(armed:false, 무throw) — 거짓
 *    발화를 만들지 않는다(옛 `useActualRoute` 선례 — 삭제됨).
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
  alternatives: [],
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

/**
 * TRIP-1333 · PBT-U10-F2 (BR-U10-09·11·13) — 리전 선택.
 * 진행 중 슬롯(도착·미완료·미건너뜀) 전부 + 당일 남은 슬롯 계획 순번, 합계 ≤ limit.
 * 좌표 없는 슬롯·그날 되돌린 슬롯·완료/건너뜀 슬롯은 0.
 */
describe('selectRegions (PBT-U10-F2)', () => {
  const DATE = '2026-08-20';
  const visit = (
    poiId: string,
    over: Partial<VisitCheck> = {}
  ): VisitCheck => ({
    visitCheckId: `v-${poiId}`,
    slotKey: `${DATE}#${poiId}`,
    poiId,
    arrivedAt: null,
    completedAt: null,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: '2026-08-20T00:00:00Z',
    ...over,
  });

  it('SR1 반경은 config 값(150m)이다 — 120m 자리값 대체(BR-U10-13)', () => {
    const [r] = buildGeofenceRegions([slot({ poiId: 'p1' })], DATE);
    expect(r.radiusM).toBe(AUTOMATION_CONFIG.geofenceRadiusM);
  });

  it('SR2 진행 중이 먼저, 그다음 남은 슬롯을 계획 순번대로', () => {
    const slots = ['a', 'b', 'c', 'd'].map((poiId) => slot({ poiId }));
    const visits = [
      visit('a', { arrivedAt: 't', completedAt: 't' }), // 완료 → 제외
      visit('c', { arrivedAt: 't' }), // 진행 중
    ];
    const picked = selectRegions(slots, visits, [], DATE, 10);
    expect(picked.map((r) => r.poiId)).toEqual(['c', 'b', 'd']);
  });

  it('SR3 되돌린 슬롯(suppressed)은 빠진다', () => {
    const slots = ['a', 'b'].map((poiId) => slot({ poiId }));
    const picked = selectRegions(slots, [], [`${DATE}#a`], DATE, 10);
    expect(picked.map((r) => r.poiId)).toEqual(['b']);
  });

  it('SR4 상한에서 남은 슬롯을 자른다', () => {
    const slots = Array.from({ length: 15 }, (_, i) =>
      slot({ poiId: `p${i}` })
    );
    expect(selectRegions(slots, [], [], DATE, 10)).toHaveLength(10);
  });

  // 생성기: 슬롯 0~25개(좌표 결측 섞음) · 슬롯별 실적 상태 · 되돌림 표식 · limit 1~12
  const arbCase = fc
    .array(
      fc.record({
        hasCoord: fc.boolean(),
        status: fc.constantFrom(
          'none',
          'inProgress',
          'completed',
          'skipped',
          'emptyRow'
        ),
        suppressed: fc.boolean(),
      }),
      { maxLength: 25 }
    )
    .chain((rows) =>
      fc.record({
        rows: fc.constant(rows),
        limit: fc.integer({ min: 1, max: 12 }),
      })
    );

  it('SR5 (PBT) 수 ≤ limit · 진행 중 전부(상한 안이면) · 결측/되돌림/완료/건너뜀 0', () => {
    fc.assert(
      fc.property(arbCase, ({ rows, limit }) => {
        const slots = rows.map((r, i) =>
          slot({
            poiId: `p${i}`,
            lat: r.hasCoord ? 35 + i / 1000 : null,
            lng: r.hasCoord ? 129 : null,
          })
        );
        const visits: VisitCheck[] = [];
        const suppressed: string[] = [];
        rows.forEach((r, i) => {
          const id = `p${i}`;
          if (r.status === 'inProgress')
            visits.push(visit(id, { arrivedAt: 't' }));
          if (r.status === 'completed')
            visits.push(visit(id, { arrivedAt: 't', completedAt: 't' }));
          if (r.status === 'skipped')
            visits.push(visit(id, { skippedAt: 't' }));
          if (r.status === 'emptyRow') visits.push(visit(id));
          if (r.suppressed) suppressed.push(`${DATE}#${id}`);
        });

        const picked = selectRegions(slots, visits, suppressed, DATE, limit);
        const ids = picked.map((p) => Number(p.poiId.slice(1)));

        expect(picked.length).toBeLessThanOrEqual(limit);
        expect(new Set(ids).size).toBe(ids.length);
        for (const i of ids) {
          const r = rows[i];
          expect(r.hasCoord).toBe(true);
          expect(['completed', 'skipped']).not.toContain(r.status);
          // 되돌린 슬롯은 남은 슬롯 후보가 아니다(진행 중이면 이탈 감지를 위해 남는다)
          if (r.status !== 'inProgress') expect(r.suppressed).toBe(false);
        }
        const inProgress = rows
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => r.status === 'inProgress' && r.hasCoord)
          .map(({ i }) => i);
        if (inProgress.length <= limit) {
          for (const i of inProgress) expect(ids).toContain(i);
        }
        // 남은 슬롯은 계획 순번 오름차순
        const rest = ids.filter((i) => rows[i].status !== 'inProgress');
        expect(rest).toEqual([...rest].sort((a, b) => a - b));
      }),
      { numRuns: 500 }
    );
  });

  it('SR6 스텁 반환 계약 유지 — {armed:false, reason:native-geofencing-not-wired}', () => {
    expect(registerGeofences([region()])).toEqual({
      armed: false,
      reason: 'native-geofencing-not-wired',
    });
  });
});
