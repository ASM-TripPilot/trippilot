import fc from 'fast-check';

import { budgetForTier } from './budgetAmount';

/**
 * TRIP-1045 AC-D1 — 예산 tier 칩의 **대표 금액** 산식(frontend-components `BudgetInputField`,
 * c2bda113 개정).
 *
 * 무엇을 보장하나: 대표 금액 = 1인 1박 단가 × 박수. 단가는 저가 50,000 · 중간 100,000 · 고급
 * 200,000 · 럭셔리 400,000원이고, 박수가 0이면 1박으로 친다. **인원은 곱하지 않는다** — 앱 예산
 * 표기가 전부 '1인 총액'이라서다(그래서 함수가 인원을 받지 않는다).
 *
 * 3동작 뼈대: 준비=tier·박수 → 실행=budgetForTier → 단언=금액.
 */

type Tier = '저가' | '중간' | '고급' | '럭셔리';

/** 정본 단가표(1인 1박). 테스트가 산식을 다시 적는 것은 이 표가 요구사항 원문이기 때문이다. */
const UNIT: Record<Tier, number> = {
  저가: 50000,
  중간: 100000,
  고급: 200000,
  럭셔리: 400000,
};

const TIERS: Tier[] = ['저가', '중간', '고급', '럭셔리'];
const tierArb = fc.constantFrom<Tier>(...TIERS);
const nightsArb = fc.integer({ min: 0, max: 30 });

describe('AC-D1 · 예제 — Figma·정본에 적힌 값', () => {
  const cases: [Tier, number, number][] = [
    // Figma `3647:2068` 금액 300,000 = 중간 10만 × 3박.
    ['중간', 3, 300000],
    // 박수 0(여행지 미정) → 1박 기준.
    ['저가', 0, 50000],
    ['고급', 3, 600000],
    ['럭셔리', 3, 1200000],
    ['럭셔리', 1, 400000],
  ];

  it.each(cases)('%s · %i박 → %i원', (tier, nights, expected) => {
    expect(budgetForTier(tier, nights)).toBe(expected);
  });
});

describe('AC-D1 · 불변식 — 임의의 tier·박수에 대해 (PBT)', () => {
  it('P1 · 결과 = 단가 × max(박수, 1)', () => {
    fc.assert(
      fc.property(tierArb, nightsArb, (tier, nights) => {
        expect(budgetForTier(tier, nights)).toBe(
          UNIT[tier] * Math.max(nights, 1)
        );
      }),
      { numRuns: 500 }
    );
  });

  it('P2 · 박수 0은 1박과 같다', () => {
    fc.assert(
      fc.property(tierArb, (tier) => {
        expect(budgetForTier(tier, 0)).toBe(budgetForTier(tier, 1));
      }),
      { numRuns: 100 }
    );
  });

  it('P3 · 같은 박수에서 저가 < 중간 < 고급 < 럭셔리', () => {
    fc.assert(
      fc.property(nightsArb, (nights) => {
        const amounts = TIERS.map((tier) => budgetForTier(tier, nights));
        for (let i = 1; i < amounts.length; i += 1) {
          expect(amounts[i]).toBeGreaterThan(amounts[i - 1]);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('P4 · 결과는 양의 정수이고, 박수가 늘면 줄지 않는다', () => {
    fc.assert(
      fc.property(tierArb, nightsArb, (tier, nights) => {
        const amount = budgetForTier(tier, nights);
        // 서버 계약 budgetTotal 은 integer — 소수·0·음수가 입력칸에 채워지면 안 된다.
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThan(0);
        expect(budgetForTier(tier, nights + 1)).toBeGreaterThanOrEqual(amount);
      }),
      { numRuns: 500 }
    );
  });
});
