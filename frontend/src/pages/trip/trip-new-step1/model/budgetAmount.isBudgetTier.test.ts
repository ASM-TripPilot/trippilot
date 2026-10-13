import fc from 'fast-check';

import { budgetForTier, isBudgetTier, type BudgetTier } from './budgetAmount';

/**
 * TRIP-1107 — 서버 응답의 예산 등급(`budget.tier`, enum 이 아닌 string)이 칩 등급 4값 중 하나인지 가르는 가드.
 *
 * 무엇을 보장하나: 저가·중간·고급·럭셔리 네 값만 참이고, 그 밖(영문·공백 섞임·빈 값·undefined)은
 * 거짓이다. 참이면 `budgetForTier` 가 반드시 금액을 돌려준다(가드와 금액표가 어긋나지 않는다).
 *
 * ⚠️ `'toString'`·`'constructor'` 같은 이름은 모든 객체가 물려받는 속성이라, 금액표에 `in` 으로
 * 물으면 참이 나온다. 그러면 `budgetForTier('toString')` 이 함수를 돌려줘 금액 칸에 함수 소스가 찍힌다.
 *
 * ⚠️ 타입 가드 판정(U6)은 jest 가 아니라 `pnpm tsc` 가 한다 — jest(babel)는 타입을 지우고 돈다.
 *
 * 3동작 뼈대: 준비=문자열 → 실행=isBudgetTier → 단언=참/거짓.
 */

const TIERS: string[] = ['저가', '중간', '고급', '럭셔리'];
const PROTOTYPE_KEYS = [
  'toString',
  'constructor',
  'hasOwnProperty',
  '__proto__',
  'valueOf',
];

const candidateArb = fc.oneof(
  fc.string(),
  fc.constantFrom(...TIERS),
  fc.constantFrom(...PROTOTYPE_KEYS)
);

describe('U1 · 칩 등급 4값은 참', () => {
  it.each(TIERS)('%s → true', (value) => {
    expect(isBudgetTier(value)).toBe(true);
  });
});

describe('U2 · 4값 밖은 거짓 — 공백을 걷어 주지 않는다', () => {
  it.each(['LOW', '', ' 저가', '저가 ', '중간가', 'luxury'])(
    '%j → false',
    (value) => {
      expect(isBudgetTier(value)).toBe(false);
    }
  );

  it('undefined → false', () => {
    expect(isBudgetTier(undefined)).toBe(false);
  });
});

describe('U3 · 물려받은 속성 이름은 거짓', () => {
  it.each(PROTOTYPE_KEYS)('%s → false', (value) => {
    expect(isBudgetTier(value)).toBe(false);
  });
});

describe('U4 · PBT — 참인 값은 정확히 4값뿐', () => {
  it('어떤 문자열이든 isBudgetTier(s) 는 "s 가 4값 중 하나"와 같다', () => {
    fc.assert(
      fc.property(candidateArb, (value) => {
        expect(isBudgetTier(value)).toBe(TIERS.includes(value));
      })
    );
  });
});

describe('U5 · PBT — 가드가 참이면 금액표에 금액이 있다', () => {
  it('isBudgetTier(s) 가 참인 s 는 budgetForTier(s, 1) 이 양의 정수다', () => {
    fc.assert(
      fc.property(candidateArb, (value) => {
        if (!isBudgetTier(value)) return;
        const amount = budgetForTier(value, 1);
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThan(0);
      })
    );
  });
});

describe('U6 · 타입 가드 — 참인 갈래에서 BudgetTier 로 좁혀진다 (tsc 판정)', () => {
  it('string | undefined 를 가드한 뒤 BudgetTier 자리에 그대로 넣을 수 있다', () => {
    const raw: string | undefined = '고급';

    if (isBudgetTier(raw)) {
      const tier: BudgetTier = raw;
      // TRIP-1256 — 고급 하루 단가 200,000 × 1일.
      expect(budgetForTier(tier, 1)).toBe(200000);
    } else {
      throw new Error('고급은 등급이어야 한다');
    }
  });
});
