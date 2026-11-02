import fc from 'fast-check';

import { legDistance } from '@/entities/place';

import { isFixedStay, sheetMeta, sheetRowKeys } from './sheetMeta';

/**
 * 일정 시트 헤더 meta·목록 key 순수 함수 — h07·h08(`DraftPage`)·h14·h16(`ItineraryPlanPage`)·
 * h11(`CoPickCompletePage`) 세 페이지가 복붙하던 식을 한 곳에 모았다(동작 무변경).
 *
 * 무엇을 보장하나:
 *  ① 모양 "[확정됨 · ]N곳[ · X.Xkm]" — 앞말은 `confirmed === true` 일 때만
 *  ② N = 규칙대로(`all` 전부 · `excludeFixedStay` 고정 숙소만 뺀 수)
 *  ③ km 는 `km && legDistance(slice(1)) !== null` 일 때만, 값은 거기서 "이동 " 을 뗀 것
 *  ④ 첫 슬롯 `distanceRange`(거점→첫 방문지, 커넥터 없음)는 결과를 못 바꾼다(TRIP-1110)
 *  ⑤ 소요 어휘 없음(INV-3)  ⑥ `km: false` 면 어떤 입력이든 km 없음(h11)
 *  key: 같은 날 같은 장소 두 번(TRIP-1296)이어도 card·conn key 가 겹치지 않는다.
 *
 * 3동작 뼈대: 준비=슬롯 배열·옵션 → 실행=sheetMeta/sheetRowKeys → 단언=문자열·key 유일성.
 */

type Slot = {
  isFixed: boolean;
  category?: string | null;
  distanceRange?: string | null;
};

function slot(over: Partial<Slot> = {}): Slot {
  return { isFixed: false, category: '관광', distanceRange: null, ...over };
}

describe('sheetMeta — 예시', () => {
  it('E1 Draft(h08) 셈 — 전부 세고 커넥터 구간 km 를 붙인다', () => {
    const slots = [
      slot({ distanceRange: '9km' }),
      slot({ distanceRange: '1.2km' }),
      slot({ distanceRange: '2.3km' }),
    ];

    expect(sheetMeta(slots, { count: 'all', km: true })).toBe('3곳 · 3.5km');
  });

  it('E2 Plan(h14) 셈 — 고정 숙소를 빼고 센다', () => {
    const slots = [
      slot({ isFixed: true, category: '숙소' }),
      slot({ distanceRange: '1km' }),
      slot({ distanceRange: '1.1km' }),
      slot({ distanceRange: '1km' }),
      slot({ isFixed: true, category: '관광', distanceRange: '1km' }),
    ];

    expect(sheetMeta(slots, { count: 'excludeFixedStay', km: true })).toBe(
      '4곳 · 4.1km'
    );
  });

  it('E3 확정(h16) — 거리를 모르면 앞말+곳 수만', () => {
    const slots = [slot(), slot(), slot({ distanceRange: '1km' }), slot()];

    expect(
      sheetMeta(slots, {
        count: 'excludeFixedStay',
        km: true,
        confirmed: true,
      })
    ).toBe('확정됨 · 4곳');
  });

  it('E4 CoPick(h11) km:false — 거리가 있어도 곳 수만', () => {
    const slots = [
      slot({ isFixed: true, category: '숙소' }),
      slot({ distanceRange: '1km' }),
      slot({ distanceRange: '2km' }),
      slot({ distanceRange: '3km' }),
      slot({ distanceRange: '4km' }),
    ];

    expect(sheetMeta(slots, { count: 'excludeFixedStay', km: false })).toBe(
      '4곳'
    );
  });

  it('E5 isFixedStay — isFixed 이면서 숙소일 때만', () => {
    expect(isFixedStay({ isFixed: true, category: '숙소' })).toBe(true);
    expect(isFixedStay({ isFixed: true, category: '관광' })).toBe(false);
    expect(isFixedStay({ isFixed: false, category: '숙소' })).toBe(false);
  });
});

// fast-check: 생성기가 만든 무작위 입력 수백 개로 성질(어떤 입력에도 참이어야 하는 문장)을 검사한다.
const distanceArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('모름'),
  fc.integer({ min: 0, max: 5000 }).map((m) => `${m}m`),
  fc.integer({ min: 0, max: 99 }).map((d) => `${d / 10}km`),
  fc.integer({ min: 1, max: 30 }).map((d) => `약 ${d / 10}km · 도보 추정`)
);
const slotArb: fc.Arbitrary<Slot> = fc.record({
  isFixed: fc.boolean(),
  category: fc.constantFrom('숙소', '관광', '맛집', null, undefined),
  distanceRange: distanceArb,
});
const slotsArb = fc.array(slotArb, { maxLength: 8 });
const optsArb = fc.record({
  count: fc.constantFrom('all' as const, 'excludeFixedStay' as const),
  km: fc.boolean(),
  confirmed: fc.constantFrom(true, false, undefined),
});

describe('sheetMeta — 성질', () => {
  it('P1 모양 "[확정됨 · ]N곳[ · X]" — 앞말은 confirmed === true 일 때만', () => {
    fc.assert(
      fc.property(slotsArb, optsArb, (slots, opts) => {
        const meta = sheetMeta(slots, opts);
        expect(meta).toMatch(/^(확정됨 · )?\d+곳( · .+)?$/);
        expect(meta.startsWith('확정됨 · ')).toBe(opts.confirmed === true);
      })
    );
  });

  it('P2 N 은 규칙대로 센다', () => {
    fc.assert(
      fc.property(slotsArb, optsArb, (slots, opts) => {
        const expected =
          opts.count === 'all'
            ? slots.length
            : slots.filter((s) => !(s.isFixed && s.category === '숙소')).length;
        const n = Number(/(\d+)곳/.exec(sheetMeta(slots, opts))?.[1]);
        expect(n).toBe(expected);
      })
    );
  });

  it('P3 km 는 km && legDistance(slice(1)) !== null 일 때만, "이동 " 뗀 값', () => {
    fc.assert(
      fc.property(slotsArb, optsArb, (slots, opts) => {
        const leg = legDistance(slots.slice(1).map((s) => s.distanceRange));
        const tail = / · (.+)$/.exec(
          sheetMeta(slots, opts).replace(/^확정됨 · /, '')
        )?.[1];
        if (opts.km && leg !== null) {
          expect(tail).toBe(leg.replace('이동 ', ''));
        } else {
          expect(tail).toBeUndefined();
        }
      })
    );
  });

  it('P4 첫 슬롯 distanceRange 를 무엇으로 바꿔도 결과가 같다(TRIP-1110)', () => {
    fc.assert(
      fc.property(
        fc.array(slotArb, { minLength: 1, maxLength: 8 }),
        distanceArb,
        optsArb,
        (slots, first, opts) => {
          const swapped = [
            { ...slots[0], distanceRange: first },
            ...slots.slice(1),
          ];
          expect(sheetMeta(swapped, opts)).toBe(sheetMeta(slots, opts));
        }
      )
    );
  });

  it('P5 소요 어휘가 없다(INV-3)', () => {
    fc.assert(
      fc.property(slotsArb, optsArb, (slots, opts) => {
        expect(sheetMeta(slots, opts)).not.toMatch(/이동|분|시간|소요/);
      })
    );
  });

  it('P6 km:false 면 어떤 입력이든 km 가 없다', () => {
    fc.assert(
      fc.property(slotsArb, optsArb, (slots, opts) => {
        expect(sheetMeta(slots, { ...opts, km: false })).not.toMatch(/곳 · /);
      })
    );
  });
});

describe('sheetRowKeys — 성질', () => {
  it('K1 poiId 가 겹치는 배열에서도 card n개·conn n-1개가 전부 유일하다(TRIP-1296)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('p-1', 'p-2', 'p-3'), { maxLength: 10 }),
        (poiIds) => {
          const keys = poiIds.map((id, i) => sheetRowKeys(i, id));
          const cards = keys.map((k) => k.card);
          const conns = keys.slice(0, -1).map((k) => k.conn);
          const all = [...cards, ...conns];
          expect(new Set(all).size).toBe(all.length);
        }
      )
    );
  });
});
