import fc from 'fast-check';

import {
  CompanionType,
  PreferenceInputCompanionTypesItem,
  type TripDestination,
} from '@/shared/api/generated/schemas';

import {
  nightsSum,
  toCompanionType,
  validateTripDraft,
  type TripDraft,
  type TripViolationCode,
} from './tripDraft';

/**
 * TRIP-204 AC-1~AC-7 · AC-9 — 여행 생성 위저드 드래프트의 판정(순수 함수 3개).
 *
 * 무엇을 보장하나: 어떤 도시·박수·기간·인원 조합에서도 `validateTripDraft`가 내는 위반 코드
 * 집합이 네 규칙과 **정확히 일치한다** — 빠뜨리지도, 남발하지도 않는다.
 *  - `NIGHTS_EXCEED_PERIOD` ⟺ `Σnights > tripLength` (INV-U1-14 · BR-U1-34)
 *  - `END_BEFORE_START`     ⟺ `endDate < startDate` (INV-U1-11 · BR-U1-36)
 *  - `NO_DESTINATION`       ⟺ 여행지 0곳 (US-TRIP-01)
 *  - `PARTY_BELOW_ONE`      ⟺ `(party ?? 1) < 1` (BR-U1-39 · frontend-components.md §5)
 * 그리고 `toCompanionType`의 결과가 서버 enum 4값 ∪ `{null}`을 벗어나지 않는다(BR-U1-39).
 *
 * **`tripLength`의 단위는 박이다** — `endDate − startDate`(INV-U1-14). 9/1~9/3은 2박이지
 * 3박이 아니다. 이 파일의 생성기는 그래서 `tripLength`를 **정수로 먼저 뽑고** 날짜 문자열을
 * 거기서 파생한다. 덕분에 테스트 안에 날짜 뺄셈이 한 줄도 없다 — 기대값을 구하려고 구현과
 * 같은 식을 다시 적는 항진명제가 구조적으로 불가능하고(선례 `stayDates.test.ts:40`),
 * `new Date('2026-06-10')`(UTC 자정) vs `new Date(2026,5,10)`(로컬 자정) 하루 밀림도
 * 함께 사라진다(`stayDates.ts:6~7` 규칙 — 에포크 일수 → ISO 문자열 한 방향).
 *
 * 판정의 정본은 서버다(INV-U1-11 · INV-U1-14 · BE TRIP-177). 이 함수들이 통과시켜도 서버가
 * 거부할 수 있고 그것이 설계상 정상이다 — 여기는 UX 사본이다.
 *
 * 박수는 `nights`라고 쓴다 — 소요 시간 식별자는 이 파일 어디에도 없다(INV-3). 그 식별자를
 * 이 주석에 적지 않는 것까지가 규칙이다: 수기 grep이 주석을 걷지 않고 훑으면 선언 문장
 * 자체가 위반으로 잡힌다(`tabbarVisual` 게이트①-2 실사고의 반대 방향).
 */

const MS_PER_DAY = 86_400_000;

/** 에포크 일수(1970-01-01 = 0)를 'YYYY-MM-DD'로. UTC 한 경로만 쓴다. */
function isoFromEpochDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 알려진 위반 코드 4종. **구현에서 가져오지 않고 테스트가 손으로 적는다** — 가져오면
 * 다섯 번째 코드가 생겨도 테스트가 따라 인정해 버려 "4종 그대로"(01b D3)가 안 잠긴다. */
const ALL_CODES: TripViolationCode[] = [
  'NO_DESTINATION',
  'END_BEFORE_START',
  'NIGHTS_EXCEED_PERIOD',
  'PARTY_BELOW_ONE',
];

// ── 생성기 ────────────────────────────────────────────────────────────────
// 씨앗(seed)은 드래프트가 아니라 **드래프트를 만드는 재료**다. `tripLength`가 정수로 남아
// 있어야 성질의 기대값을 날짜 계산 없이 적을 수 있다.

/** 1970-01-01 ~ 2100 근방(+ tripLength 최대 12일 여유). */
const epochDayArb = fc.integer({ min: 0, max: 47_500 });

/** 박. 음수 = 종료일 역전 · 0 = 당일치기 · 양수 = 정상. */
const tripLengthArb = fc.integer({ min: -4, max: 12 });

/** `region`을 임의 문자열로 두면 "판정이 지역 이름을 안 본다"를 별도 단언 없이 얻는다.
 * `nights`는 **0 이상**(01b D3) — 음수를 넣으면 Σ가 작아져 `NIGHTS_EXCEED_PERIOD` 성질이
 * 더 쉽게 통과하는 가짜 green이 된다. 계약(openapi)에 `minimum`이 없는 것은 공백이지
 * "음수가 합법"이라는 뜻이 아니다. */
const destinationArb = fc.record({
  seq: fc.integer({ min: 1, max: 20 }),
  region: fc.string(),
  nights: fc.integer({ min: 0, max: 4 }),
});

/** `minLength: 0`이 필수다 — 그래야 `NO_DESTINATION` 경로가 표본에 밟힌다. */
const destinationsArb = fc.array(destinationArb, {
  minLength: 0,
  maxLength: 5,
});

/** 미입력(`undefined`)·0 이하·정상을 한 생성기로 전부 밟는다. `nil`을 `null`이 아니라
 * `undefined`로 지정하는 것은 계약이 `party?: number`라 실제 형태가 그것이기 때문이다. */
const partyArb = fc.option(fc.integer({ min: -2, max: 6 }), { nil: undefined });

interface DraftSeed {
  startDay: number;
  tripLength: number;
  destinations: TripDestination[];
  party: number | undefined;
}

const draftSeedArb: fc.Arbitrary<DraftSeed> = fc.record({
  startDay: epochDayArb,
  tripLength: tripLengthArb,
  destinations: destinationsArb,
  party: partyArb,
});

function toDraft(seed: DraftSeed): TripDraft {
  return {
    startDate: isoFromEpochDay(seed.startDay),
    endDate: isoFromEpochDay(seed.startDay + seed.tripLength),
    destinations: seed.destinations,
    party: seed.party,
  };
}

/** 기대값 계산용 — `nightsSum` 구현을 부르지 않는다(두 단위가 같은 방향으로 틀리면
 * 서로를 통과시킨다). `nightsSum` 자체는 아래 describe가 예시와 관계식으로 따로 잠근다. */
function sumNights(destinations: TripDestination[]): number {
  return destinations.reduce((total, one) => total + one.nights, 0);
}

/** 01b D2 — `party` 미입력은 검증이 읽는 시점에 1로 간주한다(서버 계약의 `default: 1`). */
function effectiveParty(party: number | undefined): number {
  return party ?? 1;
}

describe('G-0 · 생성기 자기검증 (아래 모든 성질의 전제)', () => {
  /**
   * PBT는 생성기가 좁으면 성질이 통과해도 **아무것도 증명하지 못한다.** 그래서 성질과
   * 별개로, 500개 표본이 각 판정 경로를 실제로 밟는지 여기서 센다. 특히 `clean`(위반 0건)이
   * 0이면 "통과한 드래프트는 네 조건을 만족한다"는 역방향 성질이 공허하게 참이 된다.
   *
   * 하한은 실측의 1/4 이하다 — 500개 배치를 300번 반복했을 때의 최소 관측치가
   * nightsOver 239 · nightsWithin 180 · nightsExact 17 · reversed 115 · sameDay 21 ·
   * noDestination 68 · partyMissing 63 · partyBelowOne 123 · clean 78 이었다(02a §6-④).
   */
  const FLOORS: Record<string, number> = {
    nightsOver: 60,
    nightsWithin: 45,
    nightsExact: 3,
    reversed: 25,
    sameDay: 5,
    noDestination: 15,
    partyMissing: 15,
    partyBelowOne: 30,
    clean: 18,
  };

  it('draftSeedArb 500개가 판정 경로 9종을 전부 실제로 밟는다', () => {
    const seeds = fc.sample(draftSeedArb, 500);
    const count = (hits: (seed: DraftSeed) => boolean) =>
      seeds.filter(hits).length;

    const observed: Record<string, number> = {
      nightsOver: count((s) => sumNights(s.destinations) > s.tripLength),
      nightsWithin: count((s) => sumNights(s.destinations) <= s.tripLength),
      nightsExact: count((s) => sumNights(s.destinations) === s.tripLength),
      reversed: count((s) => s.tripLength < 0),
      sameDay: count((s) => s.tripLength === 0),
      noDestination: count((s) => s.destinations.length === 0),
      partyMissing: count((s) => s.party === undefined),
      partyBelowOne: count((s) => s.party !== undefined && s.party < 1),
      clean: count(
        (s) =>
          s.destinations.length > 0 &&
          s.tripLength >= 0 &&
          sumNights(s.destinations) <= s.tripLength &&
          effectiveParty(s.party) >= 1
      ),
    };

    const starved = Object.keys(FLOORS)
      .filter((bucket) => observed[bucket] < FLOORS[bucket])
      .map((bucket) => `${bucket}: ${observed[bucket]} < ${FLOORS[bucket]}`);
    expect(starved).toEqual([]);
  });
});

describe('nightsSum — 도시별 박수 합', () => {
  it('0곳은 0박, 1곳은 그 도시의 박수, 여러 곳은 그 합이다', () => {
    expect(nightsSum([])).toBe(0);
    expect(nightsSum([{ seq: 1, region: '제주', nights: 2 }])).toBe(2);
    expect(
      nightsSum([
        { seq: 1, region: '서울', nights: 1 },
        { seq: 2, region: '강릉', nights: 0 },
        { seq: 3, region: '부산', nights: 3 },
      ])
    ).toBe(4);
  });

  it('도시를 하나 덧붙이면 합이 정확히 그 도시의 박수만큼 커진다', () => {
    // 관계식으로 잠근다 — 테스트가 합을 다시 계산하지 않으므로 항진명제가 아니다.
    // "항상 0을 반환하는 구현"은 여기서 걸린다(덧붙인 도시의 박수가 0이 아닌 순간).
    fc.assert(
      fc.property(destinationsArb, destinationArb, (destinations, added) => {
        expect(nightsSum([...destinations, added])).toBe(
          nightsSum(destinations) + added.nights
        );
      }),
      { numRuns: 500 }
    );
  });

  it('도시 순서를 뒤집어도 합이 같다', () => {
    fc.assert(
      fc.property(destinationsArb, (destinations) => {
        expect(nightsSum([...destinations].reverse())).toBe(
          nightsSum(destinations)
        );
      }),
      { numRuns: 500 }
    );
  });
});

describe('validateTripDraft — 위반 코드 판정 (PBT)', () => {
  /**
   * 아래 네 성질은 "짝"을 붙이는 대신 **동치**로 적었다. `expect(포함 여부).toBe(조건)`
   * 한 줄이 두 방향을 동시에 잠근다 — 조건이 참인데 코드가 없으면 실패(누락), 조건이
   * 거짓인데 코드가 있으면 실패(남발). 그래서 "항상 4개를 다 반환하는 구현"도
   * "항상 빈 배열을 반환하는 구현"도 즉시 빨개진다.
   */

  it('AC-1 · NIGHTS_EXCEED_PERIOD 포함 여부가 "Σnights > tripLength"와 정확히 같다', () => {
    fc.assert(
      fc.property(draftSeedArb, (seed) => {
        const codes = validateTripDraft(toDraft(seed));

        expect(codes.includes('NIGHTS_EXCEED_PERIOD')).toBe(
          sumNights(seed.destinations) > seed.tripLength
        );
      }),
      { numRuns: 500 }
    );
  });

  it('AC-2 · END_BEFORE_START 포함 여부가 "endDate < startDate"와 정확히 같다', () => {
    fc.assert(
      fc.property(draftSeedArb, (seed) => {
        const codes = validateTripDraft(toDraft(seed));

        expect(codes.includes('END_BEFORE_START')).toBe(seed.tripLength < 0);
      }),
      { numRuns: 500 }
    );
  });

  it('AC-7 · NO_DESTINATION 포함 여부가 "여행지 0곳"과 정확히 같다', () => {
    fc.assert(
      fc.property(draftSeedArb, (seed) => {
        const codes = validateTripDraft(toDraft(seed));

        expect(codes.includes('NO_DESTINATION')).toBe(
          seed.destinations.length === 0
        );
      }),
      { numRuns: 500 }
    );
  });

  it('AC-6 · PARTY_BELOW_ONE 포함 여부가 "(party ?? 1) < 1"과 정확히 같다', () => {
    fc.assert(
      fc.property(draftSeedArb, (seed) => {
        const codes = validateTripDraft(toDraft(seed));

        expect(codes.includes('PARTY_BELOW_ONE')).toBe(
          effectiveParty(seed.party) < 1
        );
      }),
      { numRuns: 500 }
    );
  });

  it('AC-2 · 빈 배열(통과)과 "네 조건을 모두 만족한다"가 정확히 같다 — 판정이 양방향으로 닫힌다', () => {
    // 01b AC-2 뒷문장("통과한 입력은 항상 endDate ≥ startDate")의 본체다. 위 네 성질에서
    // 따라 나오지만, Seed가 문장으로 요구한 성질이라 독립된 심판점으로 둔다.
    fc.assert(
      fc.property(draftSeedArb, (seed) => {
        const codes = validateTripDraft(toDraft(seed));

        const noViolation =
          seed.destinations.length > 0 &&
          seed.tripLength >= 0 &&
          sumNights(seed.destinations) <= seed.tripLength &&
          effectiveParty(seed.party) >= 1;

        expect(codes.length === 0).toBe(noViolation);
      }),
      { numRuns: 500 }
    );
  });

  it('AC-4 · 두 번 검증하면 완전히 같고, 중복 코드가 없으며, 알려진 4코드를 벗어나지 않는다', () => {
    fc.assert(
      fc.property(draftSeedArb, (seed) => {
        const draft = toDraft(seed);

        const first = validateTripDraft(draft);
        const second = validateTripDraft(draft);

        // 순서까지 같음을 요구하는 것은 "시계·난수·전역 상태를 안 본다"는 뜻이지, 서로
        // 다른 입력 사이의 코드 순서를 계약으로 삼는다는 뜻이 아니다(01b D4 — 순서 무계약).
        expect(second).toEqual(first);
        expect(new Set(first).size).toBe(first.length);
        expect(first.filter((code) => !ALL_CODES.includes(code))).toEqual([]);
      }),
      { numRuns: 500 }
    );
  });
});

describe('validateTripDraft — 당일치기 (AC-9)', () => {
  /** 시작 = 종료(`tripLength = 0`) 전용 생성기. 도시는 **1곳 이상**이어야 한다 — 0곳이
   * 섞이면 `NO_DESTINATION`이 나와 "통과한다"는 성질 자체가 무너진다. 이 경로는 일반
   * `draftSeedArb`에서 0.2%(20,000개 중 48개)밖에 안 나와 전용 생성기가 필요하다. */
  const sameDayArb = fc.record({
    startDay: epochDayArb,
    cityCount: fc.integer({ min: 1, max: 5 }),
    party: fc.option(fc.integer({ min: 1, max: 6 }), { nil: undefined }),
  });

  it('당일치기에서 모든 박수가 0이면 통과하고, 한 곳이라도 1박이면 거부한다', () => {
    fc.assert(
      fc.property(sameDayArb, ({ startDay, cityCount, party }) => {
        const date = isoFromEpochDay(startDay);
        const zeroNights: TripDestination[] = Array.from(
          { length: cityCount },
          (_, index) => ({ seq: index + 1, region: `지역${index}`, nights: 0 })
        );

        expect(
          validateTripDraft({
            startDate: date,
            endDate: date,
            destinations: zeroNights,
            party,
          })
        ).toEqual([]);

        // 짝 — 이게 없으면 "항상 빈 배열"을 돌려주는 구현이 통과한다. tripLength가 0이므로
        // 어느 한 곳이라도 1박이면 Σ가 기간을 넘는다.
        const oneNight = zeroNights.map((one, index) =>
          index === 0 ? { ...one, nights: 1 } : one
        );
        expect(
          validateTripDraft({
            startDate: date,
            endDate: date,
            destinations: oneNight,
            party,
          })
        ).toContain('NIGHTS_EXCEED_PERIOD');
      }),
      { numRuns: 500 }
    );
  });
});

describe('validateTripDraft — 손으로 읽는 예시 (AC-1 · AC-2 · AC-6 · AC-7)', () => {
  const EXAMPLES: {
    name: string;
    draft: TripDraft;
    expected: TripViolationCode[];
  }[] = [
    {
      name: '9/1~9/3 제주 2박 → 통과 (tripLength = 2박이지 3일이 아니다)',
      draft: {
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        destinations: [{ seq: 1, region: '제주', nights: 2 }],
        party: 2,
      },
      expected: [],
    },
    {
      name: '9/1~9/3 제주 3박 → 하루 초과',
      draft: {
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        destinations: [{ seq: 1, region: '제주', nights: 3 }],
        party: 2,
      },
      expected: ['NIGHTS_EXCEED_PERIOD'],
    },
    {
      name: '9/1~9/3 서울 1박 + 부산 1박 → 다중 도시 합이 딱 맞으면 통과 (BR-U1-34)',
      draft: {
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        destinations: [
          { seq: 1, region: '서울', nights: 1 },
          { seq: 2, region: '부산', nights: 1 },
        ],
      },
      expected: [],
    },
    {
      name: '여행지 0곳 → NO_DESTINATION (US-TRIP-01 "여행지 필수")',
      draft: {
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        destinations: [],
      },
      expected: ['NO_DESTINATION'],
    },
    {
      name: '인원 0명 → PARTY_BELOW_ONE (frontend-components.md §5 "인원 ≥ 1")',
      draft: {
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        destinations: [{ seq: 1, region: '제주', nights: 2 }],
        party: 0,
      },
      expected: ['PARTY_BELOW_ONE'],
    },
    {
      name: '종료일 역전 → 역전이면 tripLength가 음수라 박수 조건도 함께 깨진다',
      draft: {
        startDate: '2026-09-03',
        endDate: '2026-09-01',
        destinations: [{ seq: 1, region: '제주', nights: 0 }],
      },
      expected: ['END_BEFORE_START', 'NIGHTS_EXCEED_PERIOD'],
    },
    {
      name: '네 코드가 동시에 나오는 최악 입력',
      draft: {
        startDate: '2026-09-03',
        endDate: '2026-09-01',
        destinations: [],
        party: 0,
      },
      expected: [
        'END_BEFORE_START',
        'NIGHTS_EXCEED_PERIOD',
        'NO_DESTINATION',
        'PARTY_BELOW_ONE',
      ],
    },
  ];

  it.each(EXAMPLES)('$name', ({ draft, expected }) => {
    // 01b D4 — 순서는 계약이 아니다. 정렬 후 집합으로 비교한다.
    expect([...validateTripDraft(draft)].sort()).toEqual([...expected].sort());
  });

  it('AC-6 · party 키가 아예 없는 드래프트도 1로 읽어 통과한다 (01b D2)', () => {
    // `toEqual`은 값이 undefined인 키를 무시하므로 "키 부재"와 "undefined"를 구별하지
    // 못한다(선례 `createTripRequest.test.ts:76~78`). 두 형태를 각각 통과시켜 확인한다.
    const base: TripDraft = {
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
    };

    expect(validateTripDraft(base)).toEqual([]);
    expect(validateTripDraft({ ...base, party: undefined })).toEqual([]);
    expect(validateTripDraft({ ...base, party: 1 })).toEqual([]);
    expect(validateTripDraft({ ...base, party: -1 })).toEqual([
      'PARTY_BELOW_ONE',
    ]);
  });
});

/**
 * 기대 매핑을 **테스트가 손으로 적는다**. `Map`을 쓰는 이유는 평범한 객체로 두면
 * `EXPECTED_COMPANION['toString']`이 `Object.prototype.toString`(함수)을 돌려주기 때문이다 —
 * `fc.string()` 표본에 `"toString"`이 실제로 등장한다(02a §6-②).
 * `부모님`이 의도적으로 빠져 있다: 서버 enum 4값에 대응이 없어 미지값(→ null)이다.
 */
const EXPECTED_COMPANION = new Map<string, CompanionType>([
  ['혼자', '혼자'],
  ['친구', '친구'],
  ['가족', '가족'],
  ['연인', '연인'],
  ['커플', '연인'],
]);

/** 온보딩 축 5값 + 여행 축 4값. 손으로 적지 않고 생성 const 객체에서 뽑으면 계약이
 * 바뀔 때 테스트가 따라간다(선례 `tripContract.test.ts:88~99`). */
const KNOWN_COMPANION_INPUTS = [
  ...Object.values(PreferenceInputCompanionTypesItem),
  ...Object.values(CompanionType),
];

/** ⚠️ `fc.oneof`는 **생성기**를 받고 `fc.constantFrom`은 **값**을 받는다. 중첩 순서를
 * 뒤집으면 에러 없이 조용히 잘못 돈다(`formatPrice.test.ts:31~33`). 바깥이 oneof다. */
const companionInputArb = fc.oneof(
  fc.constantFrom(...KNOWN_COMPANION_INPUTS),
  fc.string()
);

describe('toCompanionType — 온보딩 동반 유형 → 서버 enum (AC-3 · AC-5)', () => {
  const CASES: { input: string; expected: CompanionType | null }[] = [
    { input: '커플', expected: '연인' }, // BR-U1-39 — 이 칸의 유일한 명시 매핑
    { input: '혼자', expected: '혼자' },
    { input: '친구', expected: '친구' },
    { input: '가족', expected: '가족' },
    { input: '연인', expected: '연인' }, // 서버 축 값이 그대로 들어와도 통과한다
    { input: '부모님', expected: null }, // 서버 enum에 대응 없음 → 미지값
    { input: '', expected: null },
    { input: 'SOLO', expected: null },
    { input: 'toString', expected: null }, // 프로토타입 키로 구현하면 여기서 걸린다
  ];

  it.each(CASES)('AC-5 · $input → $expected', ({ input, expected }) => {
    expect(toCompanionType(input)).toBe(expected);
  });

  it('AC-3 · 임의 입력에서 결과가 서버 4값 ∪ {null}을 벗어나지 않고, 커플이 결과로 나오지 않는다', () => {
    const range: (CompanionType | null)[] = [
      ...Object.values(CompanionType),
      null,
    ];

    fc.assert(
      fc.property(companionInputArb, (value) => {
        const result = toCompanionType(value);

        expect(range).toContain(result);
        // 위 치역 단언에 함의되지만 01b AC-3이 문장으로 요구한 성질이라 명시한다.
        expect(result).not.toBe('커플');
        // 표와 완전 일치 — 이 줄이 "항상 null을 돌려주는 구현"을 막는다.
        expect(result).toBe(EXPECTED_COMPANION.get(value) ?? null);
      }),
      { numRuns: 500 }
    );
  });

  it('AC-3 짝 · 임의 입력 표본이 매핑 대상과 미지값을 둘 다 실제로 밟는다', () => {
    // 위 성질은 표본이 미지값 한쪽으로만 쏠리면 "항상 null"과 구별되지 않는다.
    // 실측(02a §6-④): 500개 배치 200회에서 매핑 대상 최소 187 · 미지값 최소 245.
    const values = fc.sample(companionInputArb, 500);
    const mappable = values.filter((one) => EXPECTED_COMPANION.has(one)).length;

    expect(mappable).toBeGreaterThanOrEqual(30);
    expect(values.length - mappable).toBeGreaterThanOrEqual(30);
  });
});
