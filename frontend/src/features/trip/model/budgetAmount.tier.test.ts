import fc from 'fast-check';

import { budgetForTier } from './budgetAmount';

/**
 * TRIP-1067 AC-2 — 예산 tier 칩의 **대표 금액**(frontend-components `BudgetInputField`, 2026-09-28 개정).
 *
 * 무엇을 보장하나: 대표 금액 = 온보딩 예산 범위의 가운데값인 **고정 금액**(1인 여행 총액). 저가
 * 300,000 · 중간 1,000,000 · 고급 2,000,000 · 럭셔리 4,000,000원이고, **박수·인원과 무관**하다 —
 * 그래서 함수가 tier 하나만 받는다(TRIP-1045의 "1인 1박 단가 × 박수"는 폐기).
 *
 * ⚠️ 시그니처 심판(S1)의 `@ts-expect-error` 는 jest 가 아니라 `pnpm tsc` 가 판정한다 — 박수 인자가
 * 남아 있으면 2인자 호출이 합법이라 `TS2578 Unused '@ts-expect-error' directive` 로 실패한다.
 *
 * 3동작 뼈대: 준비=tier → 실행=budgetForTier → 단언=금액.
 */

type Tier = '저가' | '중간' | '고급' | '럭셔리';

/** 정본 금액표(온보딩 범위 ~50만 · 50~150만 · 150~300만 · 300만+ 의 가운데값, 열린 끝은 30만·400만). */
const AMOUNT: Record<Tier, number> = {
  저가: 300000,
  중간: 1000000,
  고급: 2000000,
  럭셔리: 4000000,
};

const TIERS: Tier[] = ['저가', '중간', '고급', '럭셔리'];
const tierArb = fc.constantFrom<Tier>(...TIERS);

describe('AC-2 · 예제 — 정본에 적힌 네 금액', () => {
  it.each(TIERS.map((tier) => [tier, AMOUNT[tier]] as const))(
    '%s → %i원',
    (tier, expected) => {
      expect(budgetForTier(tier)).toBe(expected);
    }
  );
});

describe('AC-2 · 시그니처 — 박수 인자를 받지 않는다', () => {
  it('S1 · 매개변수는 tier 하나뿐이고, 박수를 넘기는 호출은 타입 에러다', () => {
    // 선택 인자(`nights?`)로 남겨도 length 가 2라 red.
    expect(budgetForTier.length).toBe(1);
    // @ts-expect-error 박수 인자는 제거됐다 — 2인자 호출이 컴파일되면 tsc 가 실패한다
    expect(budgetForTier('중간', 3)).toBe(1000000);
  });
});

describe('AC-2 · 불변식 — 임의의 tier·박수·인원에 대해 (PBT)', () => {
  // 새 시그니처로는 여분 인자를 못 넘기므로, "넘겨도 무시된다"를 보려고 타입만 푼다.
  const loose = budgetForTier as unknown as (...args: unknown[]) => number;

  it('P1 · 박수·인원을 함께 넘겨도 값은 tier 의 고정 금액 그대로다', () => {
    fc.assert(
      fc.property(
        tierArb,
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 1, max: 10 }),
        (tier, nights, party) => {
          const amount = loose(tier, nights, party);
          expect(amount).toBe(budgetForTier(tier));
          expect(amount).toBe(AMOUNT[tier]);
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('AC-2 · 순서·형식', () => {
  it('O1 · 저가 < 중간 < 고급 < 럭셔리', () => {
    const amounts = TIERS.map((tier) => budgetForTier(tier));
    for (let i = 1; i < amounts.length; i += 1) {
      expect(amounts[i]).toBeGreaterThan(amounts[i - 1]);
    }
  });

  it('O2 · 모든 금액이 양의 정수다', () => {
    TIERS.forEach((tier) => {
      const amount = budgetForTier(tier);
      // 서버 계약 budgetTotal 은 integer — 소수·0·음수가 입력칸에 채워지면 안 된다.
      expect(Number.isInteger(amount)).toBe(true);
      expect(amount).toBeGreaterThan(0);
    });
  });
});
