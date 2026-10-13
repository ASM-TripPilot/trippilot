import fc from 'fast-check';

import type { VisitCheck, VisitCheckList } from '@/shared/api/index.schemas';

import { deriveVisitProgress } from './visitProgress';

/**
 * TRIP-396 · AC-2 (US-ONTRIP-01) — 방문 기록에서 슬롯 진행 상태를 도출한다.
 * TRIP-1079 — 도출은 **그 날짜의 계획 레코드**(slotKey 가 `{date}#{poiId}` 로 파싱되는 것)만 센다.
 *
 * 무엇을 보장하나:
 *  - `deriveVisitProgress(list, date, planOrder)` 가 한 날의 방문 기록에서
 *    · `completedPoiIds` = 완료(completedAt≠null && skippedAt==null) poiId 들 — planOrder 순, 그 밖은 poiId 오름차순
 *    · `activePoiId`     = 도착·미완료·미건너뜀이면서 완료 목록에 없는 후보 중 **planOrder 에서 가장 앞선** poi
 *    · `visitCheckIdByPoiId` = active 레코드 1건의 poiId→visitCheckId(완료 호출에 실을 id)
 *    를 정확히 낸다. 즉석 방문(slotKey 없음)·다른 날짜·깨진 키는 완료로도 active 로도 세지 않는다(결정 1·2).
 *  - 결과는 입력 목록의 순서와 무관하다(서버 목록 정렬은 계약이 아니다, V17).
 *
 * 이 도출이 `projectSlotProgress(slots, {completedPoiIds, activePoiId})` 의 인자가 되어
 * i01 카드의 done/active/upcoming 을 가른다(브리프 데이터 흐름). 이 파일은 그 도출의 정확성만.
 *
 * 3동작 뼈대: 준비=VisitCheck 조합 → 실행=deriveVisitProgress → 단언=세 파생값.
 */

const DAY = '2026-08-20';
const OTHER_DAY = '2026-08-21';

/** VisitCheck 를 만든다 — visitCheckId·poiId 는 필수, 나머지는 "아무 것도 안 일어난" 기본값. */
const vc = (
  over: Partial<VisitCheck> & Pick<VisitCheck, 'visitCheckId' | 'poiId'>
): VisitCheck => ({
  slotKey: `${DAY}#${over.poiId}`,
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  // 서버 버전 시각(BR-U5-22 · openapi:1953) — codegen 후 required 라 픽스처가 미리 채운다(TRIP-619).
  updatedAt: '2026-08-20T13:00:05Z',
  ...over,
});

/** 즉석 방문 — slotKey 가 null. */
const spontaneous = (
  over: Partial<VisitCheck> & Pick<VisitCheck, 'visitCheckId' | 'poiId'>
): VisitCheck => vc({ ...over, slotKey: null, spontaneous: true });

/** slotKey 필드 자체가 없는 레코드 — 생성 타입이 optional 이라 서버가 빼고 보낼 수 있다(02a ★8). */
const withoutSlotKey = (v: VisitCheck): VisitCheck => {
  const copy = { ...v };
  delete copy.slotKey;
  return copy;
};

const list = (...visits: VisitCheck[]): VisitCheckList => ({ visits });

const T = '2026-08-20T13:00:00';
const T2 = '2026-08-20T13:45:00';

describe('deriveVisitProgress (AC-2)', () => {
  it('V1 도착만 한 슬롯 → activePoiId + visitCheckId, 완료 목록은 비었다', () => {
    const result = deriveVisitProgress(
      list(vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T })),
      DAY,
      ['p1']
    );

    expect(result.activePoiId).toBe('p1');
    expect(result.visitCheckIdByPoiId).toEqual({ p1: 'v1' });
    expect(result.completedPoiIds).toEqual([]);
  });

  it('V2 완료한 슬롯 → completedPoiIds, active 아님', () => {
    const result = deriveVisitProgress(
      list(
        vc({ visitCheckId: 'v2', poiId: 'p2', arrivedAt: T, completedAt: T2 })
      ),
      DAY,
      ['p2']
    );

    expect(result.completedPoiIds).toContain('p2');
    expect(result.activePoiId).toBeNull();
  });

  it('V3 건너뛴 슬롯 → 완료에도 active 에도 안 들어간다 (안 갔으므로)', () => {
    const result = deriveVisitProgress(
      list(
        vc({ visitCheckId: 'v3', poiId: 'p3', arrivedAt: T, skippedAt: T2 })
      ),
      DAY,
      ['p3']
    );

    expect(result.completedPoiIds).toEqual([]);
    expect(result.activePoiId).toBeNull();
  });

  it('V4 즉석 방문(slotKey=null)은 도착이어도 active 가 아니다 — 같은 poi 의 계획 슬롯이 있어도 (TRIP-1079 결정 2)', () => {
    const result = deriveVisitProgress(
      list(spontaneous({ visitCheckId: 'v4', poiId: 'p4', arrivedAt: T })),
      DAY,
      ['p4']
    );

    expect(result.activePoiId).toBeNull();
    expect(result.visitCheckIdByPoiId).toEqual({});
  });

  it('V5 같은 슬롯이 완료·도착 두 레코드면 완료가 진행 중을 이긴다', () => {
    const result = deriveVisitProgress(
      list(
        vc({ visitCheckId: 'v5a', poiId: 'p5', arrivedAt: T, completedAt: T2 }),
        vc({ visitCheckId: 'v5b', poiId: 'p5', arrivedAt: T })
      ),
      DAY,
      ['p5']
    );

    expect(result.completedPoiIds).toContain('p5');
    expect(result.activePoiId).not.toBe('p5');
  });

  it('V6 빈 목록 → 전부 빈 값', () => {
    expect(deriveVisitProgress(list(), DAY, [])).toEqual({
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
          const result = deriveVisitProgress(list(...visits), DAY, [
            'p0',
            'p1',
            'p2',
            'p3',
            'p4',
            'p5',
          ]);

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

describe('deriveVisitProgress — 즉석 방문·날짜 경계·순서 불변 (TRIP-1079)', () => {
  const planned = vc({ visitCheckId: 'vS', poiId: 'p1', arrivedAt: T });
  const drop = spontaneous({
    visitCheckId: 'vX',
    poiId: 'px',
    arrivedAt: '2026-08-20T12:00:00',
  });

  it.each([
    ['즉석이 목록 끝(서버 최신순에서 먼저 도착한 즉석)', [planned, drop]],
    ['즉석이 목록 앞', [drop, planned]],
  ])(
    'V8 계획 슬롯 도착 + 즉석 도착이 섞여도 계획 슬롯이 active 다 — %s (AC-1)',
    (_name, visits) => {
      const result = deriveVisitProgress(list(...visits), DAY, ['p1', 'p2']);

      expect(result.activePoiId).toBe('p1');
      expect(result.visitCheckIdByPoiId).toEqual({ p1: 'vS' });
    }
  );

  it('V9 도착 레코드가 즉석(slotKey null·필드 없음)뿐이면 어느 슬롯도 active 가 아니다 — poi 가 계획에 있어도 (AC-3 · BR-U5-03)', () => {
    const result = deriveVisitProgress(
      list(
        spontaneous({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T }),
        withoutSlotKey(
          spontaneous({ visitCheckId: 'v2', poiId: 'p2', arrivedAt: T })
        )
      ),
      DAY,
      ['p1', 'p2']
    );

    expect(result).toEqual({
      completedPoiIds: [],
      activePoiId: null,
      visitCheckIdByPoiId: {},
    });
  });

  it('V10 즉석 방문 완료는 같은 poi 의 계획 슬롯을 완료로 칠하지 않는다 (AC-5 · 결정 1)', () => {
    const result = deriveVisitProgress(
      list(
        spontaneous({
          visitCheckId: 'vP',
          poiId: 'p1',
          arrivedAt: T,
          completedAt: T2,
        }),
        vc({ visitCheckId: 'vQ', poiId: 'p2', arrivedAt: T, completedAt: T2 })
      ),
      DAY,
      ['p1', 'p2']
    );

    expect(result.completedPoiIds).toEqual(['p2']);
  });

  // p2 가 더 늦게 도착했다 — "늦은 도착이 이긴다"로 풀면 p2 가 나와 red(02a ★2, 01b-4 대체 규칙).
  const first = vc({
    visitCheckId: 'v-p1',
    poiId: 'p1',
    arrivedAt: '2026-08-20T10:00:00Z',
  });
  const second = vc({
    visitCheckId: 'v-p2',
    poiId: 'p2',
    arrivedAt: '2026-08-20T11:00:00Z',
  });

  it.each([
    ['계획 순서대로', [first, second]],
    ['계획 역순으로', [second, first]],
  ])(
    'V11 계획 active 후보가 둘이면 planOrder 에서 앞선 poi 하나만 active 다 — 입력이 %s 와도 (AC-6)',
    (_name, visits) => {
      const result = deriveVisitProgress(list(...visits), DAY, ['p1', 'p2']);

      expect(result.activePoiId).toBe('p1');
      expect(result.visitCheckIdByPoiId).toEqual({ p1: 'v-p1' });
    }
  );

  it('V12 planOrder 에 없는 후보는 active 가 되지 않는다 — 그것뿐이면 null, 섞이면 planOrder 안의 것 (AC-6)', () => {
    const outside = vc({ visitCheckId: 'vZ', poiId: 'pz', arrivedAt: T });
    const inside = vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T });

    const onlyOutside = deriveVisitProgress(list(outside), DAY, ['p1']);
    expect(onlyOutside.activePoiId).toBeNull();
    expect(onlyOutside.visitCheckIdByPoiId).toEqual({});

    const mixed = deriveVisitProgress(list(inside, outside), DAY, ['p1']);
    expect(mixed.activePoiId).toBe('p1');
    expect(mixed.visitCheckIdByPoiId).toEqual({ p1: 'v1' });
  });

  it.each([
    ['다른 날 slotKey 도착', `${OTHER_DAY}#p1`, null],
    ['다른 날 slotKey 완료', `${OTHER_DAY}#p1`, T2],
    ['구분자 없는 깨진 키', 'p1', null],
    ['날짜로 시작하지만 구분자가 둘인 깨진 키', `${DAY}#p1#x`, T2],
  ])(
    'V13 %s 레코드는 완료로도 active 로도 세지 않는다 (AC-7)',
    (_name, slotKey, completedAt) => {
      const result = deriveVisitProgress(
        list(
          vc({
            visitCheckId: 'v1',
            poiId: 'p1',
            slotKey,
            arrivedAt: T,
            completedAt,
          })
        ),
        DAY,
        ['p1']
      );

      expect(result).toEqual({
        completedPoiIds: [],
        activePoiId: null,
        visitCheckIdByPoiId: {},
      });
    }
  );

  it('V14 레코드 poiId 와 slotKey 의 poi 가 다르면 slotKey 에서 파싱한 poi 를 쓴다 (01b 확정 2)', () => {
    const result = deriveVisitProgress(
      list(
        vc({
          visitCheckId: 'v1',
          poiId: 'p-raw',
          slotKey: `${DAY}#p1`,
          arrivedAt: T,
        })
      ),
      DAY,
      ['p1']
    );

    expect(result.activePoiId).toBe('p1');
    expect(result.visitCheckIdByPoiId).toEqual({ p1: 'v1' });
  });

  const dupB = vc({ visitCheckId: 'v-b', poiId: 'p1', arrivedAt: T });
  const dupA = vc({ visitCheckId: 'v-a', poiId: 'p1', arrivedAt: T2 });

  it.each([
    ['v-b 먼저', [dupB, dupA]],
    ['v-a 먼저', [dupA, dupB]],
  ])(
    'V15 같은 슬롯에 도착·미완료 레코드가 둘이면(비정상) visitCheckId 사전순 첫째를 싣는다 — %s (01b 확정 4)',
    (_name, visits) => {
      const result = deriveVisitProgress(list(...visits), DAY, ['p1']);

      expect(result.activePoiId).toBe('p1');
      expect(result.visitCheckIdByPoiId).toEqual({ p1: 'v-a' });
    }
  );

  it('V16 completedPoiIds 는 planOrder 순 → 계획 밖은 poiId 오름차순, 중복 없이 정규화된다 (01b 확정 5)', () => {
    const done = (visitCheckId: string, poiId: string) =>
      vc({ visitCheckId, poiId, arrivedAt: T, completedAt: T2 });

    const result = deriveVisitProgress(
      list(
        done('v1', 'p3'),
        done('v2', 'pz'),
        done('v3', 'p1'),
        done('v4', 'pa'),
        done('v5', 'p1')
      ),
      DAY,
      ['p1', 'p2', 'p3']
    );

    expect(result.completedPoiIds).toEqual(['p1', 'p3', 'pa', 'pz']);
  });

  // PBT — AC-2 차단 게이트: 서버 목록 순서를 어떻게 섞어도 결과가 같고, 01b 규칙(모델)과 일치한다.
  it('V17 (PBT) 계획·즉석·다른 날·깨진 키가 섞인 목록의 어떤 순열에도 결과가 같고 규칙 모델과 일치한다 (AC-2)', () => {
    const POIS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
    type Kind = 'plan' | 'spont-null' | 'spont-absent' | 'other-day' | 'broken';
    // plan 에 무게 4 — 균등이면 계획 도착 후보가 둘 이상인 입력이 드물어 순서 의존 실수를
    // 실행마다 확률로만 잡는다(03b 참고-1).
    const kind = fc.oneof(
      { arbitrary: fc.constant<Kind>('plan'), weight: 4 },
      {
        arbitrary: fc.constantFrom<Kind>(
          'spont-null',
          'spont-absent',
          'other-day',
          'broken'
        ),
        weight: 1,
      }
    );
    const stage = fc.constantFrom<'none' | 'arrived' | 'completed' | 'skipped'>(
      'none',
      'arrived',
      'completed',
      'skipped'
    );
    // 낙관형(Z 없음)·전날 UTC·소수초·정상 Z — 시각 비교로 고르는 구현을 모델 비교가 잡는다(02a ★12).
    const at = fc.constantFrom(
      `${DAY}T00:00:00`,
      '2026-08-19T23:07:00Z',
      '2026-08-20T13:00:00.5Z',
      '2026-08-20T13:00:00Z'
    );
    const scenario = fc
      .tuple(
        fc.array(fc.tuple(kind, fc.integer({ min: 0, max: 5 }), stage, at), {
          maxLength: 10,
        }),
        fc.shuffledSubarray(POIS, { minLength: 0, maxLength: POIS.length })
      )
      .chain(([rows, planOrder]) =>
        fc.tuple(
          fc.constant(rows),
          fc.constant(planOrder),
          fc.shuffledSubarray(
            rows.map((_, i) => i),
            { minLength: rows.length, maxLength: rows.length }
          ),
          // id 번호도 섞는다 — 목록 순서대로 붙이면 "목록 첫째"와 "id 사전순 첫째"가 늘 같다(03b 참고-1).
          fc.shuffledSubarray(
            rows.map((_, i) => i),
            { minLength: rows.length, maxLength: rows.length }
          )
        )
      );

    const slotKeyOf = (k: Kind, n: number): string | null => {
      if (k === 'plan') return `${DAY}#p${n}`;
      if (k === 'other-day') return `${OTHER_DAY}#p${n}`;
      if (k === 'broken') return n % 2 === 0 ? `p${n}` : `${DAY}#p${n}#x`;
      return null;
    };

    fc.assert(
      fc.property(scenario, ([rows, planOrder, order, ids]) => {
        const visits = rows.map(([k, n, s, arrivedAt], i) => {
          const v = vc({
            visitCheckId: `v${ids[i]}`,
            poiId: `p${n}`,
            slotKey: slotKeyOf(k, n),
            spontaneous: k === 'spont-null' || k === 'spont-absent',
            arrivedAt: s === 'none' ? null : arrivedAt,
            completedAt: s === 'completed' ? T2 : null,
            skippedAt: s === 'skipped' ? T2 : null,
          });
          return k === 'spont-absent' ? withoutSlotKey(v) : v;
        });

        // 모델 — 01b 확정 2~5 를 그대로 옮긴 참조 판정(계획 레코드는 poiId == 파싱 poi 로 만들었다).
        const counted = visits.filter((v) => v.slotKey === `${DAY}#${v.poiId}`);
        const completedSet = new Set(
          counted
            .filter((v) => v.completedAt != null && v.skippedAt == null)
            .map((v) => v.poiId)
        );
        const candidates = counted.filter(
          (v) =>
            v.arrivedAt != null &&
            v.completedAt == null &&
            v.skippedAt == null &&
            !completedSet.has(v.poiId)
        );
        const expectedActive =
          planOrder.find((p) => candidates.some((v) => v.poiId === p)) ?? null;
        const expected = {
          completedPoiIds: [
            ...planOrder.filter((p) => completedSet.has(p)),
            ...[...completedSet].filter((p) => !planOrder.includes(p)).sort(),
          ],
          activePoiId: expectedActive,
          visitCheckIdByPoiId:
            expectedActive === null
              ? {}
              : {
                  [expectedActive]: candidates
                    .filter((v) => v.poiId === expectedActive)
                    .map((v) => v.visitCheckId)
                    .sort()[0],
                },
        };

        const result = deriveVisitProgress(list(...visits), DAY, planOrder);
        const shuffled = deriveVisitProgress(
          list(...order.map((i) => visits[i])),
          DAY,
          planOrder
        );

        expect(result).toEqual(expected);
        expect(shuffled).toEqual(result);
      }),
      { numRuns: 300 }
    );
  });
});
