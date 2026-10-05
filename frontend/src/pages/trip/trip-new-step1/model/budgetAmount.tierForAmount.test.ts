import fc from 'fast-check';

import { budgetForTier, tierForAmount } from './budgetAmount';

/**
 * TRIP-1091 결정 1 → TRIP-1256 AC-3·4·5 — 예산 금액을 **일수로 나눈 하루 금액**으로 역산한 등급
 * (요약 행·시트 재오픈 칩의 출처).
 *
 * 무엇을 보장하나: 하루 금액 기준 구간은 하한 포함·상한 제외다 — 저가 < 75,000 ≤ 중간 < 150,000
 * ≤ 고급 < 300,000 ≤ 럭셔리(경계는 하루 단가 사이 중간점, 01b Q1). 하루 금액을 반올림하지 않는다 —
 * `총액 < 경계 × 일수` 와 같은 답이다. 결과는 항상 네 등급 중 하나, 같은 일수에서 금액이 커지면
 * 등급이 내려가지 않고, 칩 대표 금액(`budgetForTier(t, d)`)을 같은 일수로 역산하면 그 칩 등급이다.
 *
 * 온보딩 `BUDGET_OPTIONS` 라벨(여행 총액 기준)과는 이제 다른 척도다 — 그 라벨은 이번 범위 밖(01b D5).
 *
 * 3동작 뼈대: 준비=금액·일수 → 실행=tierForAmount → 단언=등급.
 */

type Tier = '저가' | '중간' | '고급' | '럭셔리';

const TIERS: Tier[] = ['저가', '중간', '고급', '럭셔리'];
const RANK: Record<Tier, number> = { 저가: 0, 중간: 1, 고급: 2, 럭셔리: 3 };

const dayArb = fc.integer({ min: 1, max: 31 });

/** 경계(최대 300,000 × 31 = 9,300,000)가 1천만 아래라, 절반은 그 근처에서 뽑아야 단조성 검사가 경계를 밟는다. */
const amountArb = fc.oneof(
  fc.integer({ min: 0, max: 10_000_000 }),
  fc.integer({ min: 0, max: 1_000_000_000_000 })
);

describe('AC-3 · 경계 — 하루 금액 기준, 하한 포함 · 상한 제외, 반올림 없음', () => {
  it.each([
    // 224,999 ÷ 3 = 74,999.67 — 반올림하면 75,000 이 되어 중간으로 간다.
    [224999, 3, '저가'],
    [225000, 3, '중간'],
    [149999, 1, '중간'],
    [150000, 1, '고급'],
    [599999, 2, '고급'],
    [600000, 2, '럭셔리'],
    // 저가 칩(하루 50,000)이 저가로 돌아오려면 저가/중간 경계가 50,000 위여야 한다(01b Q1).
    [74999, 1, '저가'],
    [75000, 1, '중간'],
  ] as const)('%i원 · %i일 → %s', (amount, days, expected) => {
    expect(tierForAmount(amount, days)).toBe(expected);
  });
});

describe('AC-3 · 0 과 1 — 가장 아래 구간', () => {
  it('0원과 1원은 1일이든 31일이든 저가다 (0 적용 시 호출 여부는 페이지가 정한다)', () => {
    [1, 31].forEach((days) => {
      expect(tierForAmount(0, days)).toBe('저가');
      expect(tierForAmount(1, days)).toBe('저가');
    });
  });
});

describe('AC-4 · 왕복 — 칩으로 채운 금액은 모든 일수에서 그 칩 등급이다 (PBT)', () => {
  it('R1 · 임의 등급 × 일수 1~31 → tierForAmount(budgetForTier(t, d), d) === t', () => {
    fc.assert(
      fc.property(fc.constantFrom<Tier>(...TIERS), dayArb, (tier, days) => {
        expect(tierForAmount(budgetForTier(tier, days), days)).toBe(tier);
      }),
      {
        numRuns: 500,
        examples: TIERS.flatMap((tier) => [
          [tier, 1] as [Tier, number],
          [tier, 31] as [Tier, number],
        ]),
      }
    );
  });
});

describe('AC-5 · 속성 — 임의의 금액·일수에 대해 (PBT)', () => {
  it('P1 · 결과는 네 등급 중 정확히 하나다', () => {
    fc.assert(
      fc.property(amountArb, dayArb, (amount, days) => {
        expect(TIERS).toContain(tierForAmount(amount, days));
      }),
      { numRuns: 500 }
    );
  });

  it('P2 · 단조 — 같은 일수에서 금액이 크면 등급이 낮아지지 않는다', () => {
    fc.assert(
      fc.property(amountArb, amountArb, dayArb, (x, y, days) => {
        const low = Math.min(x, y);
        const high = Math.max(x, y);
        const lowRank = RANK[tierForAmount(low, days) as Tier];
        const highRank = RANK[tierForAmount(high, days) as Tier];
        // 네 등급 밖 값이면 RANK 가 undefined 라 아래 비교가 조용히 false 가 된다 — 먼저 막는다.
        expect(lowRank).toEqual(expect.any(Number));
        expect(highRank).toEqual(expect.any(Number));
        expect(lowRank).toBeLessThanOrEqual(highRank);
      }),
      { numRuns: 1000 }
    );
  });

  it('P4 · 하루 구간 × 일수 안의 임의 금액은 그 구간 등급이다 (반올림하면 상한 근처에서 red)', () => {
    const bands: [number, number, Tier][] = [
      [0, 75_000, '저가'],
      [75_000, 150_000, '중간'],
      [150_000, 300_000, '고급'],
    ];
    bands.forEach(([low, high, expected]) => {
      fc.assert(
        fc.property(
          dayArb.chain((days) =>
            fc.tuple(
              fc.constant(days),
              fc.integer({ min: low * days, max: high * days - 1 })
            )
          ),
          ([days, amount]) => {
            expect(tierForAmount(amount, days)).toBe(expected);
          }
        ),
        { numRuns: 300 }
      );
    });
    fc.assert(
      fc.property(
        dayArb.chain((days) =>
          fc.tuple(
            fc.constant(days),
            fc.integer({ min: 300_000 * days, max: 1_000_000_000_000 })
          )
        ),
        ([days, amount]) => {
          expect(tierForAmount(amount, days)).toBe('럭셔리');
        }
      ),
      { numRuns: 300 }
    );
  });
});
