import fc from 'fast-check';

import type {
  VisitCheck,
  VisitCheckList,
} from '@/shared/api/generated/schemas';

import { deriveVisitProgress } from './visitProgress';

/**
 * TRIP-396 · AC-2 (US-ONTRIP-01) — 방문 기록에서 슬롯 진행 상태를 도출한다.
 *
 * 무엇을 보장하나:
 *  - `deriveVisitProgress(VisitCheckList)` 가 한 날의 방문 기록에서
 *    · `completedPoiIds` = 완료(completedAt≠null && skippedAt==null) poiId 들
 *    · `activePoiId`     = 도착·미완료(arrivedAt≠null && completedAt==null && skippedAt==null)
 *                          이면서 **완료 목록에 없는** poiId(완료가 진행 중보다 우선)
 *    · `visitCheckIdByPoiId` = active 레코드의 poiId→visitCheckId(완료 호출에 실을 id)
 *    를 정확히 낸다. 건너뜀(skippedAt)은 어디에도 안 들어가고, 즉석 방문(slotKey=null)도 잡힌다.
 *
 * 이 도출이 `projectSlotProgress(slots, {completedPoiIds, activePoiId})` 의 인자가 되어
 * i01 카드의 done/active/upcoming 을 가른다(브리프 데이터 흐름). 이 파일은 그 도출의 정확성만.
 *
 * 3동작 뼈대: 준비=VisitCheck 조합 → 실행=deriveVisitProgress → 단언=세 파생값.
 */

/** VisitCheck 를 만든다 — visitCheckId·poiId 는 필수, 나머지는 "아무 것도 안 일어난" 기본값. */
const vc = (
  over: Partial<VisitCheck> & Pick<VisitCheck, 'visitCheckId' | 'poiId'>
): VisitCheck => ({
  slotKey: `2026-08-20#${over.poiId}`,
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  // 서버 버전 시각(BR-U5-22 · openapi:1953) — codegen 후 required 라 픽스처가 미리 채운다(TRIP-619).
  updatedAt: '2026-08-20T13:00:05Z',
  ...over,
});

const list = (...visits: VisitCheck[]): VisitCheckList => ({ visits });

const T = '2026-08-20T13:00:00';
const T2 = '2026-08-20T13:45:00';

describe('deriveVisitProgress (AC-2)', () => {
  it('V1 도착만 한 슬롯 → activePoiId + visitCheckId, 완료 목록은 비었다', () => {
    const result = deriveVisitProgress(
      list(vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T }))
    );

    expect(result.activePoiId).toBe('p1');
    expect(result.visitCheckIdByPoiId).toEqual({ p1: 'v1' });
    expect(result.completedPoiIds).toEqual([]);
  });

  it('V2 완료한 슬롯 → completedPoiIds, active 아님', () => {
    const result = deriveVisitProgress(
      list(
        vc({ visitCheckId: 'v2', poiId: 'p2', arrivedAt: T, completedAt: T2 })
      )
    );

    expect(result.completedPoiIds).toContain('p2');
    expect(result.activePoiId).toBeNull();
  });

  it('V3 건너뛴 슬롯 → 완료에도 active 에도 안 들어간다 (안 갔으므로)', () => {
    const result = deriveVisitProgress(
      list(vc({ visitCheckId: 'v3', poiId: 'p3', arrivedAt: T, skippedAt: T2 }))
    );

    expect(result.completedPoiIds).toEqual([]);
    expect(result.activePoiId).toBeNull();
  });

  it('V4 즉석 방문(slotKey=null)도 도착이면 active 로 잡힌다', () => {
    const result = deriveVisitProgress(
      list(vc({ visitCheckId: 'v4', poiId: 'p4', slotKey: null, arrivedAt: T }))
    );

    expect(result.activePoiId).toBe('p4');
  });

  it('V5 같은 poiId 가 완료·도착 두 레코드면 완료가 진행 중을 이긴다', () => {
    const result = deriveVisitProgress(
      list(
        vc({ visitCheckId: 'v5a', poiId: 'p5', arrivedAt: T, completedAt: T2 }),
        vc({ visitCheckId: 'v5b', poiId: 'p5', arrivedAt: T })
      )
    );

    expect(result.completedPoiIds).toContain('p5');
    expect(result.activePoiId).not.toBe('p5');
  });

  it('V6 빈 목록 → 전부 빈 값', () => {
    expect(deriveVisitProgress(list())).toEqual({
      completedPoiIds: [],
      activePoiId: null,
      visitCheckIdByPoiId: {},
    });
  });

  // PBT — 분류 정확성: 어떤 조합에서도 완료/진행 판정이 술어를 벗어나지 않는다.
  it('V7 (PBT) completedPoiIds·activePoiId 는 각 술어를 만족하고 서로 겹치지 않는다', () => {
    const stage = fc.constantFrom<'none' | 'arrived' | 'completed' | 'skipped'>(
      'none',
      'arrived',
      'completed',
      'skipped'
    );
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), stage), {
          maxLength: 8,
        }),
        (rows) => {
          const visits = rows.map(([n, s], i) =>
            vc({
              visitCheckId: `v${i}`,
              poiId: `p${n}`,
              arrivedAt: s === 'none' ? null : T,
              completedAt: s === 'completed' ? T2 : null,
              skippedAt: s === 'skipped' ? T2 : null,
            })
          );
          const result = deriveVisitProgress(list(...visits));

          // 완료 목록의 모든 poiId 는 (완료 && 미건너뜀) 레코드가 실제로 있다.
          for (const poiId of result.completedPoiIds) {
            expect(
              visits.some(
                (v) =>
                  v.poiId === poiId &&
                  v.completedAt != null &&
                  v.skippedAt == null
              )
            ).toBe(true);
          }
          // activePoiId 는 null 이거나 (도착·미완료·미건너뜀) && 완료 목록에 없음.
          if (result.activePoiId !== null) {
            expect(
              visits.some(
                (v) =>
                  v.poiId === result.activePoiId &&
                  v.arrivedAt != null &&
                  v.completedAt == null &&
                  v.skippedAt == null
              )
            ).toBe(true);
            expect(result.completedPoiIds).not.toContain(result.activePoiId);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});
