import fc from 'fast-check';

import {
  resolveStaySearchState,
  type StaySearchState,
} from './staySearchState';

/**
 * AC-8(01b Seed §2-2 · §4) — `resolveStaySearchState`가 5종 화면 상태를 결정론적으로 판정한다.
 *
 * 무엇을 보장하나: `(isPending, isError, itemCount, degraded, filterZeroReasons)` 다섯 입력의
 * 어떤 조합에서도 결과 `kind`는 정확히 5개 리터럴 중 하나이고(undefined·"아무것도 아님" 없음),
 * 우선순위표(loading > error > results > filter-zero > empty)를 지킨다. 예제 7행이 그 표를
 * 리터럴로 고정하고, PBT 5개가 완전성·짝·전파 성질을 임의 입력 500회로 검증한다.
 */

const KINDS: StaySearchState['kind'][] = [
  'loading',
  'error',
  'results',
  'filter-zero',
  'empty',
];

const inputArb = fc.record({
  isPending: fc.boolean(),
  isError: fc.boolean(),
  itemCount: fc.nat({ max: 50 }),
  degraded: fc.boolean(),
  filterZeroReasons: fc.array(fc.string(), { maxLength: 5 }),
});

describe('resolveStaySearchState — 우선순위표 예제 (AC-8)', () => {
  // 배열 원소 타입을 명시하지 않으면 `kind` 리터럴이 `string`으로 넓어져 `StaySearchState`에
  // 대입할 때 타입 에러가 난다(§5 ★1).
  const CASES: {
    name: string;
    input: {
      isPending: boolean;
      isError: boolean;
      itemCount: number;
      degraded: boolean;
      filterZeroReasons: string[];
    };
    expected: StaySearchState;
  }[] = [
    {
      name: 'loading이 전부를 이긴다',
      input: {
        isPending: true,
        isError: true,
        itemCount: 5,
        degraded: true,
        filterZeroReasons: ['amenity:조식'],
      },
      expected: { kind: 'loading' },
    },
    {
      name: 'error가 results를 이긴다',
      input: {
        isPending: false,
        isError: true,
        itemCount: 5,
        degraded: true,
        filterZeroReasons: ['amenity:조식'],
      },
      expected: { kind: 'error' },
    },
    {
      name: 'default 얼굴',
      input: {
        isPending: false,
        isError: false,
        itemCount: 3,
        degraded: false,
        filterZeroReasons: [],
      },
      expected: { kind: 'results', degraded: false },
    },
    {
      name: '결과가 있으면 filter-zero보다 우선(=partial-failure)',
      input: {
        isPending: false,
        isError: false,
        itemCount: 3,
        degraded: true,
        filterZeroReasons: ['amenity:조식'],
      },
      expected: { kind: 'results', degraded: true },
    },
    {
      name: '0건 + 사유 있음',
      input: {
        isPending: false,
        isError: false,
        itemCount: 0,
        degraded: false,
        filterZeroReasons: ['amenity:조식'],
      },
      expected: {
        kind: 'filter-zero',
        reasons: ['amenity:조식'],
        degraded: false,
      },
    },
    {
      name: '0건 + 사유 없음',
      input: {
        isPending: false,
        isError: false,
        itemCount: 0,
        degraded: false,
        filterZeroReasons: [],
      },
      expected: { kind: 'empty', degraded: false },
    },
    {
      name: 'AC-10 배너 겹침의 재료',
      input: {
        isPending: false,
        isError: false,
        itemCount: 0,
        degraded: true,
        filterZeroReasons: [],
      },
      expected: { kind: 'empty', degraded: true },
    },
  ];

  // toEqual은 undefined 필드를 무시한다(§5 ★12) — degraded 유무의 실질은 F1-6이 따로 잠근다.
  it.each(CASES)('$name', ({ input, expected }) => {
    expect(resolveStaySearchState(input)).toEqual(expected);
  });
});

describe('resolveStaySearchState — 성질(PBT)', () => {
  it('임의 입력에 대해 항상 5개 kind 중 하나를 반환하고, 동일 입력은 동일 출력이다', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const first = resolveStaySearchState(input);
        const second = resolveStaySearchState(input);
        expect(KINDS).toContain(first.kind);
        expect(second).toEqual(first);
      }),
      { numRuns: 500 }
    );
  });

  it('kind==="filter-zero"이면 reasons가 비어있지 않고 입력과 같다', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = resolveStaySearchState(input);
        if (result.kind === 'filter-zero') {
          expect(result.reasons.length).toBeGreaterThanOrEqual(1);
          expect(result.reasons).toEqual(input.filterZeroReasons);
        }
      }),
      { numRuns: 500 }
    );

    // 가짜 통과 방지 짝 — "항상 empty를 반환하는 구현"도 위 성질만으로는 통과하므로,
    // filterZeroReasons가 비지 않고 itemCount===0인 입력이 실제로 filter-zero를 낸다는
    // 것도 같은 it에서 잠근다(§5 F1-3).
    fc.assert(
      fc.property(
        fc.record({
          isPending: fc.constant(false),
          isError: fc.constant(false),
          itemCount: fc.constant(0),
          degraded: fc.boolean(),
          filterZeroReasons: fc.array(fc.string(), {
            minLength: 1,
            maxLength: 3,
          }),
        }),
        (input) => {
          expect(resolveStaySearchState(input).kind).toBe('filter-zero');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('kind==="results"이면 itemCount>=1이다', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = resolveStaySearchState(input);
        if (result.kind === 'results') {
          expect(input.itemCount).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 500 }
    );

    // 가짜 통과 방지 짝 — itemCount>=1 고정 입력은 실제로 results를 낸다.
    fc.assert(
      fc.property(
        fc.record({
          isPending: fc.constant(false),
          isError: fc.constant(false),
          itemCount: fc.integer({ min: 1, max: 50 }),
          degraded: fc.boolean(),
          filterZeroReasons: fc.array(fc.string(), { maxLength: 5 }),
        }),
        (input) => {
          expect(resolveStaySearchState(input).kind).toBe('results');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('isPending·isError가 나머지 필드를 무시하고 loading·error를 확정한다', () => {
    fc.assert(
      fc.property(
        fc.record({
          isPending: fc.constant(true),
          isError: fc.boolean(),
          itemCount: fc.nat({ max: 50 }),
          degraded: fc.boolean(),
          filterZeroReasons: fc.array(fc.string(), { maxLength: 5 }),
        }),
        (input) => {
          expect(resolveStaySearchState(input)).toEqual({ kind: 'loading' });
        }
      ),
      { numRuns: 500 }
    );

    fc.assert(
      fc.property(
        fc.record({
          isPending: fc.constant(false),
          isError: fc.constant(true),
          itemCount: fc.nat({ max: 50 }),
          degraded: fc.boolean(),
          filterZeroReasons: fc.array(fc.string(), { maxLength: 5 }),
        }),
        (input) => {
          expect(resolveStaySearchState(input)).toEqual({ kind: 'error' });
        }
      ),
      { numRuns: 500 }
    );
  });

  it('degraded가 results·filter-zero·empty엔 그대로 전파되고, loading·error엔 아예 없다', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = resolveStaySearchState(input);
        if (
          result.kind === 'results' ||
          result.kind === 'filter-zero' ||
          result.kind === 'empty'
        ) {
          expect(result.degraded).toBe(input.degraded);
        } else {
          expect('degraded' in result).toBe(false);
        }
      }),
      { numRuns: 500 }
    );
  });
});
