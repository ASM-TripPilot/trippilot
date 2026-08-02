import fc from 'fast-check';

import { resolvePlaceListState, type PlaceListState } from './placeListState';

/**
 * AC-1 · AC-2 · AC-3 (01b Seed Q2·Q3·Q11) — `resolvePlaceListState` 가 d04 의 다섯 얼굴을
 * 결정론적으로 판정한다.
 *
 * 무엇을 보장하나: `(isPending, isError, itemCount, hasQuery, hasCategory)` 다섯 입력의 **어떤
 * 조합에서도** 결과 `kind` 가 5개 리터럴 중 정확히 하나이고 "아무것도 아님"이 없으며(INV-4),
 * 우선순위표(loading > error > results > filter-zero > empty)를 지킨다. 예제 8행이 그 표를
 * 리터럴로 고정하고, 성질(PBT) 6개가 완전성·역방향 짝·전파를 임의 입력 500회로 검증한다.
 * PBT 는 리포 CI 의 차단 게이트다 — 100% 통과하지 못하면 머지되지 않는다.
 *
 * 개념 두 가지만 적는다.
 *  - **PBT(속성 기반 테스트)**: 예제를 손으로 적는 대신 "어떤 입력에도 성립해야 하는 성질"을
 *    적으면 fast-check 가 임의 입력을 만들어 반례를 찾는다.
 *  - **가짜 통과 방지 짝**: `kind` 를 항상 `'empty'` 로 돌려주는 엉터리 구현도 "5갈래 중
 *    하나"·"filter-zero 면 …" 같은 조건부 성질은 전부 만족한다(전제가 거짓이면 함의는 참).
 *    그래서 각 갈래가 **실제로 나오는** 고정 입력을 역방향으로 함께 건다.
 */

type Input = {
  isPending: boolean;
  isError: boolean;
  itemCount: number;
  hasQuery: boolean;
  hasCategory: boolean;
};

const KINDS: PlaceListState['kind'][] = [
  'loading',
  'error',
  'results',
  'filter-zero',
  'empty',
];

const inputArb = fc.record<Input>({
  isPending: fc.boolean(),
  isError: fc.boolean(),
  itemCount: fc.nat({ max: 50 }),
  hasQuery: fc.boolean(),
  hasCategory: fc.boolean(),
});

/** 판정에 쓰이지 않는 필드를 기본값으로 채운다 — 예제 표에서 관심 있는 칸만 보이게. */
function input(overrides: Partial<Input>): Input {
  return {
    isPending: false,
    isError: false,
    itemCount: 0,
    hasQuery: false,
    hasCategory: false,
    ...overrides,
  };
}

describe('resolvePlaceListState — 우선순위표 예제 (AC-2)', () => {
  // 배열 원소 타입을 명시하지 않으면 `kind` 리터럴이 `string` 으로 넓어져 `PlaceListState` 에
  // 대입할 때 타입 에러가 난다.
  const CASES: { name: string; input: Input; expected: PlaceListState }[] = [
    {
      name: 'loading 이 전부를 이긴다',
      input: input({
        isPending: true,
        isError: true,
        itemCount: 5,
        hasQuery: true,
        hasCategory: true,
      }),
      expected: { kind: 'loading' },
    },
    {
      name: 'error 가 results 를 이긴다',
      input: input({ isError: true, itemCount: 5, hasQuery: true }),
      expected: { kind: 'error' },
    },
    {
      name: 'default 얼굴 — 결과가 있으면 results',
      input: input({ itemCount: 3 }),
      expected: { kind: 'results' },
    },
    {
      name: '결과가 있으면 필터가 걸려 있어도 results 다',
      input: input({ itemCount: 3, hasQuery: true, hasCategory: true }),
      expected: { kind: 'results' },
    },
    {
      name: '0건 + 검색어 → 검색어를 지목한다',
      input: input({ itemCount: 0, hasQuery: true }),
      expected: { kind: 'filter-zero', blame: 'search' },
    },
    {
      name: '0건 + 카테고리만 → 카테고리를 지목한다',
      input: input({ itemCount: 0, hasCategory: true }),
      expected: { kind: 'filter-zero', blame: 'category' },
    },
    {
      // 01b Seed Q3 ⓐ — 마지막에 적용된 필터이고 되돌리기 비용이 낮다. 해제 후에도 카테고리
      // 때문에 0건이면 그때 카테고리를 지목한다(점진 해제).
      name: '0건 + 검색어·카테고리 둘 다 → 검색어를 먼저 지목한다',
      input: input({ itemCount: 0, hasQuery: true, hasCategory: true }),
      expected: { kind: 'filter-zero', blame: 'search' },
    },
    {
      name: '0건 + 필터 없음 → empty',
      input: input({ itemCount: 0 }),
      expected: { kind: 'empty' },
    },
  ];

  it.each(CASES)('$name', ({ input: given, expected }) => {
    expect(resolvePlaceListState(given)).toEqual(expected);
  });
});

describe('resolvePlaceListState — 성질(PBT · AC-1 · AC-3)', () => {
  it('임의 입력에 대해 항상 5개 kind 중 하나를 내고, 같은 입력은 같은 출력이다', () => {
    fc.assert(
      fc.property(inputArb, (given) => {
        const first = resolvePlaceListState(given);
        const second = resolvePlaceListState(given);

        // "아무것도 아님"이 없다 — INV-4 의 본체다.
        expect(first.kind).toBeDefined();
        expect(KINDS).toContain(first.kind);
        // 결정론 — 같은 입력에서 두 번 다른 얼굴이 나오면 화면이 깜빡인다.
        expect(second).toEqual(first);
      }),
      { numRuns: 500 }
    );
  });

  it('kind 별로 여분의 필드가 붙지 않는다', () => {
    fc.assert(
      fc.property(inputArb, (given) => {
        const result = resolvePlaceListState(given);
        const expectedKeys =
          result.kind === 'filter-zero' ? ['blame', 'kind'] : ['kind'];

        // `toEqual` 은 값이 `undefined` 인 필드를 무시한다 — 그래서 위 예제 표만으로는
        // `{kind:'empty', blame: undefined}` 같은 구현을 못 잡는다. 키 목록으로 메운다.
        expect(Object.keys(result).sort()).toEqual(expectedKeys);
      }),
      { numRuns: 500 }
    );
  });

  it('filter-zero 는 0건 + 필터 있음일 때만 나오고, 실제로 있는 조건을 지목한다', () => {
    fc.assert(
      fc.property(inputArb, (given) => {
        const result = resolvePlaceListState(given);
        if (result.kind !== 'filter-zero') return;

        expect(given.itemCount).toBe(0);
        expect(given.hasQuery || given.hasCategory).toBe(true);
        // 지목이 거짓말을 하면 사용자가 존재하지 않는 조건을 해제하려 든다.
        expect(
          result.blame === 'search' ? given.hasQuery : given.hasCategory
        ).toBe(true);
      }),
      { numRuns: 500 }
    );

    // 가짜 통과 방지 짝 — 0건이고 필터가 하나라도 있으면 **실제로** filter-zero 가 나온다.
    fc.assert(
      fc.property(
        fc
          .record({
            hasQuery: fc.boolean(),
            hasCategory: fc.boolean(),
          })
          .filter(({ hasQuery, hasCategory }) => hasQuery || hasCategory),
        ({ hasQuery, hasCategory }) => {
          expect(
            resolvePlaceListState(
              input({ itemCount: 0, hasQuery, hasCategory })
            ).kind
          ).toBe('filter-zero');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('results 는 itemCount>=1 일 때만 나온다', () => {
    fc.assert(
      fc.property(inputArb, (given) => {
        if (resolvePlaceListState(given).kind === 'results') {
          expect(given.itemCount).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 500 }
    );

    // 가짜 통과 방지 짝
    fc.assert(
      fc.property(
        fc.record({
          itemCount: fc.integer({ min: 1, max: 50 }),
          hasQuery: fc.boolean(),
          hasCategory: fc.boolean(),
        }),
        (partial) => {
          expect(resolvePlaceListState(input(partial)).kind).toBe('results');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('empty 는 0건이고 필터가 하나도 없을 때만 나온다', () => {
    fc.assert(
      fc.property(inputArb, (given) => {
        if (resolvePlaceListState(given).kind === 'empty') {
          expect(given.itemCount).toBe(0);
          expect(given.hasQuery).toBe(false);
          expect(given.hasCategory).toBe(false);
        }
      }),
      { numRuns: 500 }
    );

    // 가짜 통과 방지 짝 — 그 조합은 실제로 empty 다.
    expect(resolvePlaceListState(input({ itemCount: 0 })).kind).toBe('empty');
  });

  it('isPending·isError 는 나머지 필드를 무시하고 loading·error 를 확정한다', () => {
    fc.assert(
      fc.property(
        fc.record<Input>({
          isPending: fc.constant(true),
          isError: fc.boolean(),
          itemCount: fc.nat({ max: 50 }),
          hasQuery: fc.boolean(),
          hasCategory: fc.boolean(),
        }),
        (given) => {
          expect(resolvePlaceListState(given)).toEqual({ kind: 'loading' });
        }
      ),
      { numRuns: 500 }
    );

    fc.assert(
      fc.property(
        fc.record<Input>({
          isPending: fc.constant(false),
          isError: fc.constant(true),
          itemCount: fc.nat({ max: 50 }),
          hasQuery: fc.boolean(),
          hasCategory: fc.boolean(),
        }),
        (given) => {
          expect(resolvePlaceListState(given)).toEqual({ kind: 'error' });
        }
      ),
      { numRuns: 500 }
    );
  });
});
