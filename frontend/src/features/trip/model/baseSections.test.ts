import fc from 'fast-check';

import type {
  BaseAssignment,
  SavedStay,
  Trip,
} from '@/shared/api/generated/schemas';

import { toBaseSections, type BaseSection } from './baseSections';

/**
 * TRIP-224 · US-TRIP-07 · BR-U1-28 — toBaseSections: 배정·저장숙소·여행 → 거점 구간 행.
 *
 * 무엇을 보장하나: 배정 하나가 결과 행 하나가 되고(날짜 수만큼 쪼개지지 않는다), 각 행이
 * `nights`(에포크 일수 차)와 `nightLabel`(여행 시작일 기준 몇 번째 밤인가)을 갖는다. 라벨의
 * 구분자는 en dash `–`(U+2013)이며, 짝 맞는 저장 숙소가 없어도 행은 살아남고 이름만 빈
 * 문자열이 된다. 결과는 `dateFrom` 오름차순이고, 결과 길이는 언제나 입력 길이다. 여행 기간
 * 밖 배정도 거르지 않고 산식 그대로 낸다(INV-2 — 거르는 것은 판정이고 판정은 서버 몫이다).
 * 순수 함수라 화면·서버 없이 검증한다.
 *
 * 커버하지 않는 것:
 *  - `toEpochDay`가 파일 내부(private)인지 — 구현 내부라 동작으로 표현할 수 없다.
 *  - `dateFrom`이 같은 두 행의 상대 순서 — 안정 정렬이라 **입력 순서에 의존한다**. 그래서
 *    "입력을 섞어도 결과가 같다"는 성질은 쓸 수 없고(거짓이다), 여기서는 "결과의 dateFrom이
 *    오름차순"까지만 확인한다. 더 강한 성질을 넣으려는 시도는 반드시 실패한다.
 *  - 'YYYY-MM-DD' 꼴이 아닌 날짜 문자열 — 계약(format: date)이 보장하므로 방어 코드를
 *    요구하지 않는다. 생성기도 만들지 않는다.
 *  - g02 화면 표시 — TRIP-225 몫. 이 함수는 호출자가 없는 채로 머지된다.
 *
 * 3동작: 준비(픽스처·생성기로 입력 조립) → 실행(toBaseSections 1회 호출) → 단언(반환 배열).
 */

// ── 상수 ──────────────────────────────────────────────────────────────────────

/**
 * 구간 라벨의 구분자. 라이브 Figma `1861:2317`의 `1–2박`은 **en dash U+2013**이고,
 * 티켓·정본 문서가 옮겨 적으며 잃은 ASCII 물결 `~`·하이픈 `-`과는 다른 문자다.
 * 이 리포는 같은 자리에서 이미 데였다(`stayDateImport.ts:32-34` 주석).
 * 눈으로는 구분되지 않으므로 **상수 하나만 두고 기대값도 정규식도 전부 이걸로 조립한다.**
 */
const EN_DASH = '–';

/** 라이브 Figma `1861:2312` 부제 `밤별 거점 · 6월 10일–13일` 실측. */
const TRIP_START = '2026-06-10';
const TRIP_END = '2026-06-13';

/**
 * nightLabel이 가져야 하는 모양. `1–2박`(범위형) 또는 `3박`(단일형)이다.
 *
 * - `^…$`로 양끝을 묶는다 — `toMatch(정규식)`은 전체 일치가 아니라 **부분 일치**라서
 *   (expect/build/matchers.js:1071 `new RegExp(expected).test(received)`) 앵커가 없으면
 *   `'1–2박 30분'`도 통과한다.
 * - `-?`로 **음수 부호를 허용한다** — 여행 기간 밖 배정을 거르지 않으므로(D3) `-1–0박` 같은
 *   라벨이 실제로 나온다. 허용하지 않으면 구현과 무관하게 성질이 거짓이 된다.
 * - 리터럴 정규식이 아니라 `new RegExp`로 조립하는 이유: 정규식 안의 구분자와 기대 문자열
 *   안의 구분자가 **같은 바이트임이 구조적으로 보장**되기 때문이다.
 */
const NIGHT_LABEL_SHAPE = new RegExp(`^(-?\\d+)(?:${EN_DASH}(-?\\d+))?박$`);

/**
 * BaseSection이 가져야 하는 필드 전부. `Record<keyof BaseSection, true>`는 "모든 키를 빠짐없이
 * 적어라"는 뜻이라, 타입에 필드가 하나라도 늘면 **여기서 컴파일 에러**가 난다. 아래
 * BASE_SECTION_KEYS와 짝을 이뤄 `region`(계약에 없다)·`duration`(INV-3)이 몰래 붙는 것을 막는다.
 */
const BASE_SECTION_SHAPE: Record<keyof BaseSection, true> = {
  baseAssignmentId: true,
  savedStayId: true,
  stayName: true,
  dateFrom: true,
  dateTo: true,
  nights: true,
  nightLabel: true,
};

/** 런타임 객체의 키 집합과 대조할 정렬본. 타입에 없는 필드가 객체에 달려 나오면 잡힌다. */
const BASE_SECTION_KEYS = Object.keys(BASE_SECTION_SHAPE).sort();

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

/**
 * 라벨에서 박 번호 두 개를 뽑는다. 단일형(`3박`)이면 first === last로 본다.
 * 모양이 안 맞으면 던진다 — 조용히 NaN을 비교해 통과하는 일을 막는다.
 */
function parseNightLabel(label: string): { first: number; last: number } {
  const matched = NIGHT_LABEL_SHAPE.exec(label);
  if (matched === null) {
    throw new Error(
      `nightLabel 모양이 계약과 다르다: ${JSON.stringify(label)}`
    );
  }
  const first = Number(matched[1]);
  return { first, last: matched[2] === undefined ? first : Number(matched[2]) };
}

/**
 * 계약(BaseAssignment)의 required 4필드를 채운 픽스처. 상상해서 만들지 않고 orval 생성 타입을
 * 그대로 쓴다 — 계약이 바뀌면 여기서 컴파일이 깨져야 한다.
 */
function assignment(over: Partial<BaseAssignment> = {}): BaseAssignment {
  return {
    baseAssignmentId: 'A1',
    savedStayId: 'S1',
    dateFrom: TRIP_START,
    dateTo: '2026-06-12',
    ...over,
  };
}

/** 계약(SavedStay)의 required 6필드를 채운 픽스처. */
function stay(over: Partial<SavedStay> = {}): SavedStay {
  return {
    savedStayId: 'S1',
    name: '해운대 오션 호텔',
    coordConfirmed: true,
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

/** 계약(Trip)의 required 10필드를 채운 픽스처. 이 함수가 읽는 것은 startDate 하나뿐이지만,
 *  `as Trip` 캐스팅으로 얼버무리면 계약 변경을 놓치므로 전부 채운다. */
function trip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 'T1',
    title: '부산·경주 3박 4일',
    startDate: TRIP_START,
    endDate: TRIP_END,
    party: 2,
    preferenceSnapshot: {},
    destinations: [],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

// ── PBT 입력 도메인 (describe 밖 — 파일 전체에서 재사용) ─────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * 에포크 일수(1970-01-01부터 센 날 수) → 'YYYY-MM-DD'.
 * `toISOString()`은 항상 UTC로 직렬화하므로 실행 머신의 타임존이 표본을 하루 밀지 않는다.
 * **입력을 만드는 데만 쓰고, 기대값 계산에는 쓰지 않는다**(아래 buildInput 주석 참조).
 */
function toDateString(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 생성기가 배정 하나를 만들기 위해 뽑는 정수 파라미터 묶음. */
interface Slot {
  /** 여행 시작일로부터 며칠 뒤에 체크인하나. 음수면 여행 시작 전이다. */
  offset: number;
  /** 몇 박 묵나. 0·음수면 dateTo <= dateFrom이 된다(계약 밖 입력). */
  nights: number;
  /** 짝 맞는 SavedStay를 목록에 넣을 것인가. false면 조인이 실패한다. */
  join: boolean;
  name: string;
}

interface GeneratedInput {
  assignments: BaseAssignment[];
  savedStays: SavedStay[];
  trip: Trip;
  /** 배정 id → 기대값. **날짜 산술을 다시 짠 것이 아니라 생성기가 뽑은 정수 그대로**다. */
  expected: Record<string, { nights: number; firstNight: number }>;
}

/**
 * 정수 파라미터(offset·nights)로 기대값을 **먼저** 정하고, 그 정수를 날짜 문자열로 바꿔 입력을
 * 만든다. 구현은 "문자열 → 에포크 → 차이" 경로로 같은 숫자에 도달해야 한다 — 경로가 서로 달라야
 * 오라클이 독립적이다. 테스트 안에 toEpochDay를 다시 짜면 구현과 같은 버그를 함께 갖는다.
 */
function buildInput(
  startEpoch: number,
  span: number,
  slots: Slot[]
): GeneratedInput {
  const assignments: BaseAssignment[] = [];
  const savedStays: SavedStay[] = [];
  const expected: GeneratedInput['expected'] = {};

  slots.forEach((slot, index) => {
    const baseAssignmentId = `a${index}`;
    const savedStayId = `s${index}`;
    const fromEpoch = startEpoch + slot.offset;

    assignments.push(
      assignment({
        baseAssignmentId,
        savedStayId,
        dateFrom: toDateString(fromEpoch),
        dateTo: toDateString(fromEpoch + slot.nights),
      })
    );
    expected[baseAssignmentId] = {
      nights: slot.nights,
      firstNight: slot.offset + 1,
    };

    if (slot.join) savedStays.push(stay({ savedStayId, name: slot.name }));
  });

  return {
    assignments,
    savedStays,
    trip: trip({
      startDate: toDateString(startEpoch),
      endDate: toDateString(startEpoch + span),
    }),
    expected,
  };
}

/** 표본이 만드는 여행 시작일 범위 — 2025-11-08 ~ 2026-12-13(실행으로 확인). */
const TRIP_START_EPOCH_ARB = fc.integer({ min: 20_400, max: 20_800 });
/** 여행 기간 일수. 계약 범위 생성기에서 마지막 박 번호의 상한이 된다. */
const TRIP_SPAN_ARB = fc.integer({ min: 1, max: 30 });
/** 빈 이름을 일부러 섞는다 — 조인 성공인데 이름이 ''인 경우와 조인 실패는 결과가 같다(D5). */
const STAY_NAME_ARB = fc.constantFrom(
  '해운대 오션 호텔',
  '경주 한옥스테이 봄',
  ''
);

/**
 * 배정 슬롯 배열. `maxLength`만 주면 fast-check의 최소 길이는 0이라 **빈 배열 표본이 공짜로
 * 섞인다**(1000표본 중 160여 건 — 실행으로 확인). 그래서 "입력이 비면 결과도 빈다"는 별도
 * 예제 테스트를 두지 않는다.
 *
 * wide=false(계약 범위)면 체크아웃이 여행 종료일을 넘지 않도록 박 수를 깎는다.
 * offset이 span-1 이하라 깎은 뒤에도 nights >= 1이 보장된다.
 */
function slotsArb(span: number, wide: boolean) {
  return fc
    .array(
      fc.record({
        offset: wide
          ? fc.integer({ min: -5, max: span + 5 })
          : fc.integer({ min: 0, max: span - 1 }),
        nights: wide
          ? fc.integer({ min: -2, max: 10 })
          : fc.integer({ min: 1, max: span }),
        join: fc.boolean(),
        name: STAY_NAME_ARB,
      }),
      { maxLength: 6 }
    )
    .map((slots) =>
      wide
        ? slots
        : slots.map((slot) => ({
            ...slot,
            nights: Math.min(slot.nights, span - slot.offset),
          }))
    );
}

/**
 * 여행 기간을 먼저 뽑고(chain), 그 기간에 맞춰 배정 슬롯을 뽑는다. chain은 "앞에서 뽑힌 값에
 * 의존하는 생성기"를 만들 때 쓴다 — span을 모르면 계약 범위 offset을 뽑을 수 없다.
 */
function inputArb(wide: boolean) {
  return fc
    .record({ startEpoch: TRIP_START_EPOCH_ARB, span: TRIP_SPAN_ARB })
    .chain(({ startEpoch, span }) =>
      fc.record({
        startEpoch: fc.constant(startEpoch),
        span: fc.constant(span),
        slots: slotsArb(span, wide),
      })
    )
    .map(({ startEpoch, span, slots }) => buildInput(startEpoch, span, slots));
}

/**
 * 계약(INV-U1-15)이 지켜지는 입력만 만든다 — `startDate <= dateFrom < dateTo <= endDate`.
 * 표본 1000건에서 기간 밖 0건·nights<=0 0건·firstNight 최솟값 1을 확인했다.
 * **P1·P2만 이걸 탄다** — 두 성질은 계약이 지켜질 때만 참이라 wideArb로 옮기면 거짓이 된다.
 */
const contractArb = inputArb(false);

/**
 * 계약 밖까지 넓힌 입력 — 여행 기간 이전/이후 체크인, nights <= 0, 빈 배열, 조인 실패를 섞는다.
 * 표본 1000건에서 기간 이전 666행·기간 이후 1133행·nights<=0 646행·firstNight 최솟값 -4·
 * 조인 실패 1370행을 확인했다(생성기가 이름만 넓은 게 아님을 실행으로 확인).
 * **P3~P7이 이걸 탄다** — 계약과 무관하게 참이어야 하는 성질이고, 계약 범위만 생성하면 기간 밖
 * 동작을 무작위 검증이 원리적으로 못 본다.
 */
const wideArb = inputArb(true);

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('toBaseSections — 배정·저장숙소·여행 → 거점 구간 행 (TRIP-224)', () => {
  it('6/10→6/12 배정 하나를 nights=2 · "1–2박" 한 행으로 만든다 (AC-1, 예제)', () => {
    // 준비 — 라이브 Figma 1행 실측. 여행 시작 6/10, 짝 맞는 숙소가 있다.
    const assignments = [
      assignment({
        baseAssignmentId: 'A1',
        savedStayId: 'S1',
        dateFrom: '2026-06-10',
        dateTo: '2026-06-12',
      }),
    ];
    const savedStays = [stay({ savedStayId: 'S1', name: '해운대 오션 호텔' })];

    // 실행
    const result = toBaseSections(assignments, savedStays, trip());

    // 단언 L1 — 배정 1건은 행 1건이다(날짜 수만큼 쪼개지지 않는다 — BR-U1-28).
    expect(result).toHaveLength(1);

    // 단언 L2 — 산식: nights = 6/12 - 6/10 = 2박(체크아웃 당일은 숙박일이 아니다).
    expect(result[0].nights).toBe(2);

    // 단언 L3 — 라벨: 여행 시작 6/10 기준 1번째~2번째 밤. 구분자는 en dash다.
    expect(result[0].nightLabel).toBe(`1${EN_DASH}2박`);

    // 단언 L4 — 조인 성공이면 숙소 이름이 실린다.
    expect(result[0].stayName).toBe('해운대 오션 호텔');

    // 단언 L5 — 나머지 4필드는 입력을 그대로 나른다(가공하지 않는다).
    expect(result[0].baseAssignmentId).toBe('A1');
    expect(result[0].savedStayId).toBe('S1');
    expect(result[0].dateFrom).toBe('2026-06-10');
    expect(result[0].dateTo).toBe('2026-06-12');

    // 단언 L6 — 필드가 정확히 7개다. region도 duration도 없다(계약에 없는 것을 발명하지 않는다).
    expect(Object.keys(result[0]).sort()).toEqual(BASE_SECTION_KEYS);
  });

  it('6/12→6/13 배정을 nights=1 · "3박"(구분자 없는 단일형)으로 만든다 (AC-2, 예제)', () => {
    // 준비 — 라이브 Figma 2행 실측. 여행 시작은 여전히 6/10이다.
    const assignments = [
      assignment({
        baseAssignmentId: 'A2',
        savedStayId: 'S2',
        dateFrom: '2026-06-12',
        dateTo: '2026-06-13',
      }),
    ];
    const savedStays = [
      stay({ savedStayId: 'S2', name: '경주 한옥스테이 봄' }),
    ];

    // 실행
    const result = toBaseSections(assignments, savedStays, trip());

    // 단언 — 1박이라 첫 밤과 마지막 밤이 같고, 그때는 범위가 아니라 숫자 하나만 쓴다.
    expect(result).toHaveLength(1);
    expect(result[0].nights).toBe(1);
    expect(result[0].nightLabel).toBe('3박');
  });

  it('입력이 dateFrom 역순이어도 결과는 dateFrom 오름차순이다 (AC-3, 예제)', () => {
    // 준비 — 늦은 배정을 먼저 넣는다.
    const later = assignment({
      baseAssignmentId: 'A2',
      savedStayId: 'S2',
      dateFrom: '2026-06-12',
      dateTo: '2026-06-13',
    });
    const earlier = assignment({
      baseAssignmentId: 'A1',
      savedStayId: 'S1',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-12',
    });

    // 실행
    const result = toBaseSections([later, earlier], [], trip());

    // 단언 — 날짜와 원본 id가 함께 뒤집혔다(정렬이 값만 옮기고 행을 섞지 않았다).
    expect(result.map((row) => row.dateFrom)).toEqual([
      '2026-06-10',
      '2026-06-12',
    ]);
    expect(result.map((row) => row.baseAssignmentId)).toEqual(['A1', 'A2']);
  });

  it('짝 맞는 저장 숙소가 없어도 행이 살아남고 stayName만 빈 문자열이 된다 (AC-4, 예제)', () => {
    // 준비 — 배정이 가리키는 S-MISSING이 savedStays 어디에도 없다.
    const assignments = [
      assignment({ baseAssignmentId: 'A1', savedStayId: 'S-MISSING' }),
    ];
    const savedStays = [stay({ savedStayId: 'S1' })];

    // 실행
    const result = toBaseSections(assignments, savedStays, trip());

    // 단언 L1 — 행을 떨구지 않는다(결과 길이 = 입력 길이가 조인 실패에도 지켜진다).
    expect(result).toHaveLength(1);

    // 단언 L2 — 이름만 빈 문자열이다. 정본에 없는 대체 문구('(이름 없음)' 류)를 발명하지 않는다.
    expect(result[0].stayName).toBe('');

    // 단언 L3 — 식별자는 지워지지 않는다(화면이 나중에 다시 조인할 수 있어야 한다).
    expect(result[0].baseAssignmentId).toBe('A1');
    expect(result[0].savedStayId).toBe('S-MISSING');
  });

  it('여행 시작일보다 이른 배정도 거르지 않고 산식 그대로 "0박"을 낸다 (AC-5, 예제)', () => {
    // 준비 — 여행은 6/10 시작인데 배정이 6/9에 체크인한다(계약이 금지하는 입력).
    const assignments = [
      assignment({
        baseAssignmentId: 'A0',
        savedStayId: 'S1',
        dateFrom: '2026-06-09',
        dateTo: '2026-06-10',
      }),
    ];

    // 실행
    const result = toBaseSections(assignments, [stay()], trip());

    // 단언 L1 — 이 케이스의 핵심: 걸러내지 않는다. 거르는 것은 판정이고 판정은 서버 몫이다(INV-2).
    expect(result).toHaveLength(1);

    // 단언 L2 — 산식 그대로. firstNight = (6/9 - 6/10) + 1 = 0 이라 라벨이 '0박'이다.
    expect(result[0].nights).toBe(1);
    expect(result[0].nightLabel).toBe('0박');
  });

  it('배정 사이에 하루 공백이 있으면 박 번호가 건너뛴다 — "1–2박" 다음이 "4박" (AC-6, 예제)', () => {
    // 준비 — 6/12~6/13이 비어 있다. 여행 시작은 6/10.
    const assignments = [
      assignment({
        baseAssignmentId: 'A1',
        savedStayId: 'S1',
        dateFrom: '2026-06-10',
        dateTo: '2026-06-12',
      }),
      assignment({
        baseAssignmentId: 'A3',
        savedStayId: 'S3',
        dateFrom: '2026-06-13',
        dateTo: '2026-06-14',
      }),
    ];

    // 실행
    const result = toBaseSections(
      assignments,
      [],
      trip({ endDate: '2026-06-14' })
    );

    // 단언 — 두 번째 행이 '4박'이다. 앞 배정을 이어 세는 "누적 카운터"로 짜면 '3박'이 나온다.
    // Figma 실측 2건은 연속 배정이라 두 산식이 같은 값을 낸다 — 이 케이스가 유일한 판별기다.
    expect(result.map((row) => row.nightLabel)).toEqual([
      `1${EN_DASH}2박`,
      '4박',
    ]);
  });

  it('계약 범위 입력에서는 모든 행의 nights가 1 이상이다 (AC-P1, PBT · contractArb)', () => {
    fc.assert(
      fc.property(contractArb, ({ assignments, savedStays, trip: t }) => {
        // 준비 — contractArb가 startDate <= dateFrom < dateTo <= endDate를 보장한다.
        // 실행
        const result = toBaseSections(assignments, savedStays, t);

        // 단언 — 계약이 dateTo > dateFrom을 보장하므로 0박·음수박이 나올 수 없다.
        for (const row of result) {
          expect(row.nights).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('계약 범위 입력에서는 모든 행의 첫 박 번호가 1 이상이다 (AC-P2, PBT · contractArb)', () => {
    fc.assert(
      fc.property(contractArb, ({ assignments, savedStays, trip: t }) => {
        // 준비 — contractArb는 dateFrom이 여행 시작일 이상인 배정만 만든다.
        // 실행
        const result = toBaseSections(assignments, savedStays, t);

        // 단언 — 라벨에서 첫 숫자를 뽑아 확인한다(모양이 어긋나면 parseNightLabel이 던진다).
        for (const row of result) {
          expect(parseNightLabel(row.nightLabel).first).toBeGreaterThanOrEqual(
            1
          );
        }
      }),
      { numRuns: 500 }
    );
  });

  it('결과 길이가 항상 입력 길이이고 배정 id 집합이 그대로다 (AC-P3, PBT · wideArb)', () => {
    fc.assert(
      fc.property(wideArb, ({ assignments, savedStays, trip: t }) => {
        // 준비 — wideArb는 조인 실패와 빈 배열을 섞는다.
        // 실행
        const result = toBaseSections(assignments, savedStays, t);

        // 단언 L1 — 누락도 증식도 없다. 다박 배정이 날짜 수만큼 쪼개지지 않는다(BR-U1-28).
        expect(result).toHaveLength(assignments.length);

        // 단언 L2 — 길이만 보면 "한 행이 사라지고 다른 행이 두 번" 나온 경우를 못 잡는다.
        // 생성기가 유일한 id를 붙여 주므로 정렬한 id 배열을 통째로 대조한다.
        expect(result.map((row) => row.baseAssignmentId).sort()).toEqual(
          assignments.map((a) => a.baseAssignmentId).sort()
        );
      }),
      { numRuns: 500 }
    );
  });

  it('nights와 박 번호가 생성기가 만든 기대값과 정확히 같다 (AC-P4, PBT · wideArb)', () => {
    fc.assert(
      fc.property(wideArb, ({ assignments, savedStays, trip: t, expected }) => {
        // 준비 — expected는 생성기가 뽑은 정수 그대로다(날짜 산술 재구현이 아니다).
        // 실행
        const result = toBaseSections(assignments, savedStays, t);

        for (const row of result) {
          const want = expected[row.baseAssignmentId];
          const parsed = parseNightLabel(row.nightLabel);
          const wantLast = want.firstNight + want.nights - 1;

          // 단언 L1 — 박 수는 에포크 일수 차 그대로다(기간 밖이라고 깎거나 막지 않는다).
          expect(row.nights).toBe(want.nights);

          // 단언 L2 — 첫 밤 번호는 여행 시작일 기준이다.
          expect(parsed.first).toBe(want.firstNight);

          // 단언 L3 — 마지막 밤 번호는 첫 밤 + 박 수 - 1이다.
          expect(parsed.last).toBe(wantLast);

          // 단언 L4 — 두 번호가 같으면 범위형이 아니라 단일형으로 쓴다(의도된 중복: L2·L3에
          // 이미 숫자는 담겼고, 여기서는 '어느 서식을 골랐나'를 잠근다).
          expect(row.nightLabel).toBe(
            want.firstNight === wantLast
              ? `${want.firstNight}박`
              : `${want.firstNight}${EN_DASH}${wantLast}박`
          );
        }
      }),
      { numRuns: 500 }
    );
  });

  it('결과의 dateFrom이 항상 오름차순이다 (AC-P5, PBT · wideArb)', () => {
    fc.assert(
      fc.property(wideArb, ({ assignments, savedStays, trip: t }) => {
        // 준비 — wideArb가 배정 순서를 임의로 만든다.
        // 실행
        const result = toBaseSections(assignments, savedStays, t);

        // 단언 — 인접 쌍만 보면 충분하다. 'YYYY-MM-DD'는 문자열 비교가 곧 날짜 순서다.
        // dateFrom이 같은 두 행의 상대 순서는 안정 정렬이라 입력에 의존하므로 여기서 안 본다.
        for (let i = 1; i < result.length; i += 1) {
          expect(result[i - 1].dateFrom <= result[i].dateFrom).toBe(true);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('결과에 소요 시간 표현이 없고 계약 밖 필드도 없다 (AC-P6, PBT · wideArb)', () => {
    fc.assert(
      fc.property(wideArb, ({ assignments, savedStays, trip: t }) => {
        // 준비 — wideArb(기간 밖·음수 박 번호 포함).
        // 실행
        const result = toBaseSections(assignments, savedStays, t);

        for (const row of result) {
          // 단언 L1 — 긍정 앵커 먼저. 이게 없으면 아래 부정 3줄은 빈 문자열에도 통과한다.
          expect(row.nightLabel).toMatch(NIGHT_LABEL_SHAPE);

          // 단언 L2 — 필드가 정확히 7개다. duration 필드를 얹지 않는다(INV-3).
          expect(Object.keys(row).sort()).toEqual(BASE_SECTION_KEYS);

          // 단언 L3 — 부정 3종. 이 함수가 만드는 유일한 문자열은 nightLabel이다
          // (stayName·dateFrom·dateTo는 입력을 그대로 나르므로 대상이 아니다).
          expect(row.nightLabel).not.toMatch(/duration/i);
          expect(row.nightLabel).not.toContain('분');
          expect(row.nightLabel).not.toContain('소요');
        }
      }),
      { numRuns: 500 }
    );
  });

  it('같은 입력을 두 번 호출하면 같은 값이고 입력 배열이 변하지 않는다 (AC-P7, PBT · wideArb)', () => {
    fc.assert(
      fc.property(wideArb, ({ assignments, savedStays, trip: t }) => {
        // 준비 — 호출 전 입력을 문자열로 찍어 둔다(깊은 비교용 스냅숏).
        const assignmentsBefore = JSON.stringify(assignments);
        const savedStaysBefore = JSON.stringify(savedStays);

        // 실행 — 같은 입력으로 두 번 호출한다.
        const first = toBaseSections(assignments, savedStays, t);
        const second = toBaseSections(assignments, savedStays, t);

        // 단언 L1 — 결정성: 호출 사이에 남는 상태·난수가 없다.
        expect(second).toEqual(first);

        // 단언 L2 — 입력 불변: sort()는 제자리 정렬이라 그냥 쓰면 호출자의 배열이 뒤집힌다.
        // 결정성 단언만으로는 못 잡는다(두 번째 호출도 같은 값을 내기 때문).
        expect(JSON.stringify(assignments)).toBe(assignmentsBefore);
        expect(JSON.stringify(savedStays)).toBe(savedStaysBefore);
      }),
      { numRuns: 500 }
    );
  });
});
