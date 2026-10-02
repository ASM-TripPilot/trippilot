import fc from 'fast-check';

import { budgetForTier, tierForAmount } from './budgetAmount';

/**
 * TRIP-1091 결정 1 — 예산 금액을 온보딩 구간표로 **역산**한 등급(요약 행·시트 재오픈 칩의 출처).
 *
 * 무엇을 보장하나: 구간은 하한 포함·상한 제외다 — 저가 < 500,000 ≤ 중간 < 1,500,000 ≤ 고급
 * < 3,000,000 ≤ 럭셔리. 결과는 항상 네 등급 중 하나, 금액이 커지면 등급이 내려가지 않고, 칩 대표
 * 금액(`budgetForTier`)을 넣으면 그 칩 등급으로 돌아온다.
 *
 * 구간표 출처는 온보딩 `BUDGET_OPTIONS` 라벨(~50만 · 50~150만 · 150~300만 · 300만+)이다. 형제
 * feature 라 import 할 수 없어 숫자를 여기 따로 적는다 — 온보딩 라벨이 바뀌어도 이 표는 안 따라간다.
 *
 * 3동작 뼈대: 준비=금액 → 실행=tierForAmount → 단언=등급.
 */

type Tier = '저가' | '중간' | '고급' | '럭셔리';

const TIERS: Tier[] = ['저가', '중간', '고급', '럭셔리'];
const RANK: Record<Tier, number> = { 저가: 0, 중간: 1, 고급: 2, 럭셔리: 3 };

/** 경계 셋이 모두 300만 아래라, 절반은 그 근처에서 뽑아야 단조성 검사가 경계를 밟는다. */
const amountArb = fc.oneof(
  fc.integer({ min: 0, max: 5_000_000 }),
  fc.integer({ min: 0, max: 1_000_000_000_000 })
);

describe('AC1 · 경계 — 하한 포함 · 상한 제외', () => {
  it.each([
    [499999, '저가'],
    [500000, '중간'],
    [1499999, '중간'],
    [1500000, '고급'],
    [2999999, '고급'],
    [3000000, '럭셔리'],
  ] as const)('%i원 → %s', (amount, expected) => {
    expect(tierForAmount(amount)).toBe(expected);
  });
});

describe('AC3 · 0 과 1 — 가장 아래 구간', () => {
  it('0원과 1원은 저가다 (0 적용 시 호출 여부는 페이지가 정한다)', () => {
    expect(tierForAmount(0)).toBe('저가');
    expect(tierForAmount(1)).toBe('저가');
  });
});

describe('AC2 · 속성 — 임의의 금액에 대해 (PBT)', () => {
  it('P1 · 결과는 네 등급 중 정확히 하나다', () => {
    fc.assert(
      fc.property(amountArb, (amount) => {
        expect(TIERS).toContain(tierForAmount(amount));
      }),
      { numRuns: 500 }
    );
  });

  it('P2 · 단조 — 금액이 크면 등급이 낮아지지 않는다', () => {
    fc.assert(
      fc.property(amountArb, amountArb, (x, y) => {
        const low = Math.min(x, y);
        const high = Math.max(x, y);
        const lowRank = RANK[tierForAmount(low) as Tier];
        const highRank = RANK[tierForAmount(high) as Tier];
        // 네 등급 밖 값이면 RANK 가 undefined 라 아래 비교가 조용히 false 가 된다 — 먼저 막는다.
        expect(lowRank).toEqual(expect.any(Number));
        expect(highRank).toEqual(expect.any(Number));
        expect(lowRank).toBeLessThanOrEqual(highRank);
      }),
      { numRuns: 1000 }
    );
  });

  it('P3 · 왕복 — 칩 대표 금액을 역산하면 그 칩 등급이다', () => {
    fc.assert(
      fc.property(fc.constantFrom<Tier>(...TIERS), (tier) => {
        expect(tierForAmount(budgetForTier(tier))).toBe(tier);
      })
    );
  });

  it('P4 · 구간 안 임의 금액은 그 구간 등급이다', () => {
    const bands: [fc.Arbitrary<number>, Tier][] = [
      [fc.integer({ min: 0, max: 499_999 }), '저가'],
      [fc.integer({ min: 500_000, max: 1_499_999 }), '중간'],
      [fc.integer({ min: 1_500_000, max: 2_999_999 }), '고급'],
      [fc.integer({ min: 3_000_000, max: 1_000_000_000_000 }), '럭셔리'],
    ];
    bands.forEach(([arb, expected]) => {
      fc.assert(
        fc.property(arb, (amount) => {
          expect(tierForAmount(amount)).toBe(expected);
        }),
        { numRuns: 300 }
      );
    });
  });
});
