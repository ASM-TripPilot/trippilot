import fc from 'fast-check';

import type { TripDestination } from '@/shared/api/index.schemas';

import { budgetForTier, tripDayCount } from './budgetAmount';

/**
 * TRIP-1256 AC-1·AC-2 — 예산 tier 칩의 **대표 금액** = 1인 하루 단가 × 여행 일수.
 *
 * 무엇을 보장하나: 하루 단가는 저가 50,000 · 중간 100,000 · 고급 200,000 · 럭셔리 400,000원이고,
 * 대표 금액은 그 단가에 일수를 곱한 값이다. 인원은 곱하지 않는다(1인 총액). 일수는
 * `tripDayCount(여행지)` = 박수 합 + 1 이다 — 당일치기·여행지 0곳은 1일, 상한 30박은 31일.
 * (TRIP-1067 고정 가운데값 → 폐기, TRIP-1045 1박 단가 × 박수 → '일' 기준으로 되살림)
 *
 * ⚠️ 시그니처 심판(S1)의 `@ts-expect-error` 는 jest 가 아니라 `pnpm tsc` 가 판정한다 — 일수가 선택
 * 인자(`days?`)거나 인원 인자가 남아 있으면 그 호출이 합법이라 `TS2578` 로 실패한다.
 *
 * 3동작 뼈대: 준비=tier·일수(또는 여행지) → 실행=budgetForTier/tripDayCount → 단언=금액/일수.
 */

type Tier = '저가' | '중간' | '고급' | '럭셔리';

/** 사용자 결정(2026-10-05)의 하루 단가표 — 기대값을 만드는 오라클. */
const DAILY: Record<Tier, number> = {
  저가: 50000,
  중간: 100000,
  고급: 200000,
  럭셔리: 400000,
};

const TIERS: Tier[] = ['저가', '중간', '고급', '럭셔리'];
const tierArb = fc.constantFrom<Tier>(...TIERS);
/** 일수 1~31 — 박수 상한 30(`MAX_TRIP_NIGHTS`) + 1. */
const dayArb = fc.integer({ min: 1, max: 31 });

function destination(
  seq: number,
  region: string,
  nights: number
): TripDestination {
  return { seq, region, nights };
}

describe('AC-1 · 예제 — 하루 단가 × 일수', () => {
  it.each([
    ['저가', 1, 50000],
    ['중간', 3, 300000],
    ['고급', 4, 800000],
    ['럭셔리', 31, 12400000],
  ] as const)('%s · %i일 → %i원', (tier, days, expected) => {
    expect(budgetForTier(tier, days)).toBe(expected);
  });
});

describe('AC-1 · 시그니처 — 일수는 필수, 인원 인자는 없다', () => {
  it('S1 · 매개변수는 tier·일수 둘이고, 일수를 빼거나 인원을 더한 호출은 타입 에러다', () => {
    // 기본값 인자(`days = 1`)는 length 에 안 잡혀 1 이 된다 → red.
    expect(budgetForTier.length).toBe(2);
    // 아래 두 호출은 tsc 판정용이라 실행하지 않는다.
    const withoutDays = () =>
      // @ts-expect-error 일수는 필수다 — 1인자 호출이 컴파일되면 tsc 가 실패한다
      budgetForTier('중간');
    const withParty = () =>
      // @ts-expect-error 인원은 곱하지 않는다(1인 총액) — 3인자 호출이 컴파일되면 tsc 가 실패한다
      budgetForTier('중간', 3, 2);
    expect(withoutDays).toBeInstanceOf(Function);
    expect(withParty).toBeInstanceOf(Function);
  });
});

describe('AC-1 · 불변식 — 임의의 등급·일수(1~31)에 대해 (PBT)', () => {
  it('P1 · 금액은 정확히 하루 단가 × 일수다', () => {
    fc.assert(
      fc.property(tierArb, dayArb, (tier, days) => {
        expect(budgetForTier(tier, days)).toBe(DAILY[tier] * days);
      }),
      {
        numRuns: 500,
        examples: [
          ['저가', 1],
          ['럭셔리', 31],
        ],
      }
    );
  });

  it('P2 · 금액은 양의 정수다', () => {
    fc.assert(
      fc.property(tierArb, dayArb, (tier, days) => {
        const amount = budgetForTier(tier, days);
        // 서버 계약 budgetTotal 은 integer — 소수·0·음수가 입력칸에 채워지면 안 된다.
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThan(0);
      }),
      { examples: [['저가', 1]] }
    );
  });

  it('P3 · 같은 일수 안에서 저가 < 중간 < 고급 < 럭셔리', () => {
    fc.assert(
      fc.property(dayArb, (days) => {
        const amounts = TIERS.map((tier) => budgetForTier(tier, days));
        for (let i = 1; i < amounts.length; i += 1) {
          expect(amounts[i]).toBeGreaterThan(amounts[i - 1]);
        }
      }),
      { examples: [[1], [31]] }
    );
  });

  it('P4 · 일수가 늘면 금액이 줄지 않는다', () => {
    fc.assert(
      fc.property(tierArb, dayArb, dayArb, (tier, x, y) => {
        const fewer = Math.min(x, y);
        const more = Math.max(x, y);
        expect(budgetForTier(tier, fewer)).toBeLessThanOrEqual(
          budgetForTier(tier, more)
        );
      }),
      { numRuns: 500, examples: [['중간', 1, 31]] }
    );
  });
});

describe('AC-2 · 여행 일수 = 박수 합 + 1 (기간 미정·여행지 0곳은 1일)', () => {
  it.each([
    ['여행지 0곳(박수 미정)', 1, []],
    ['당일치기(서울 0박)', 1, [destination(1, '서울', 0)]],
    ['부산 3박', 4, [destination(1, '부산', 3)]],
    [
      '부산 2박 + 경주 1박(박수 합)',
      4,
      [destination(1, '부산', 2), destination(2, '경주', 1)],
    ],
    ['상한 30박', 31, [destination(1, '서울', 30)]],
  ] as const)('%s → %i일', (_label, expected, destinations) => {
    expect(tripDayCount([...destinations])).toBe(expected);
  });

  it('D2 · 임의의 여행지 목록에서 일수는 박수 합 + 1 이고, 입력 목록을 바꾸지 않는다 (PBT)', () => {
    const destinationsArb = fc
      .array(fc.integer({ min: 0, max: 10 }), { maxLength: 5 })
      .map((nightsList) =>
        nightsList.map((nights, i) =>
          destination(i + 1, `도시${i + 1}`, nights)
        )
      );

    fc.assert(
      fc.property(destinationsArb, (destinations) => {
        const before = destinations.map((one) => ({ ...one }));
        const sum = before.reduce((total, one) => total + one.nights, 0);

        expect(tripDayCount(destinations)).toBe(sum + 1);
        expect(destinations).toEqual(before);
      }),
      { numRuns: 300, examples: [[[]]] }
    );
  });
});
