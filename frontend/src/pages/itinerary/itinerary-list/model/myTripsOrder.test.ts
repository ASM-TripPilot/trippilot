import fc from 'fast-check';

import type { ItineraryStatus, Trip } from '@/shared/api/index.schemas';

import type { DoneBarEntry } from './doneBar';
import {
  byLatest,
  orderMyTrips,
  byStart,
  byTitle,
  parseMyTripsSortKey,
} from './myTripsOrder';

/**
 * TRIP-1121 · AC-5·AC-6 — h06 "내 여행" 목록 순서 `orderMyTrips(entries, today, compare = byLatest)`.
 *
 * 규칙(01b D3): [여행 중(확정 + 오늘이 기간 안)] 을 맨 위에, 나머지를 그 아래에 둔다. 두 묶음 모두 같은
 * 비교자로 정렬한다(기본 최신순). 일정이 아직 안 온(pending) 여행은 판정할 수 없으니 고정하지 않는다(INV-4).
 *
 * 무엇을 보장하나:
 *  - 여행 중이 더 옛날에 수정됐어도 맨 위, 나머지는 최신순 그대로.
 *  - 입력 배열은 바뀌지 않는다 — 페이지가 `list[i] ↔ itineraries[i]` 인덱스로 짝지어서, 원본이 바뀌면
 *    배지·배너가 엉뚱한 여행에 붙는다(02a ★6).
 *  - 비교자를 갈아끼우면 두 묶음이 모두 그 순서를 따른다(1122 정렬 시트 자리).
 *
 * *(개념 — 비교자 주입)* 정렬 규칙을 함수 인자로 받는다. `(a, b) => 음수`면 a 가 앞. 기본값이 있어 지금
 *   호출부는 인자를 안 줘도 되고, 1122 는 비교자만 바꿔 넘긴다.
 * *(개념 — `Object.freeze`)* 배열을 얼려 바꾸지 못하게 한다. 얼린 배열에 제자리 `sort` 를 부르면
 *   TypeError 가 나므로, "복사본에 정렬했는가"를 에러 유무로 바로 드러낸다.
 */

const TODAY = '2026-09-29';

function trip(
  tripId: string,
  updatedAt: string,
  period: { startDate: string; endDate: string },
  title = tripId
): Trip {
  return {
    tripId,
    title,
    ...period,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 1 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt,
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

const IN = { startDate: '2026-09-28', endDate: '2026-10-01' }; // 오늘 포함
const FUTURE = { startDate: '2026-10-10', endDate: '2026-10-12' };
const PAST = { startDate: '2026-06-10', endDate: '2026-06-13' };

function entry(t: Trip, status?: ItineraryStatus): DoneBarEntry {
  return { trip: t, itinerary: { status, generationState: 'COMPLETE' } };
}
const pendingEntry = (t: Trip): DoneBarEntry => ({
  trip: t,
  itinerary: 'pending',
});
const ids = (trips: Trip[]) => trips.map((t) => t.tripId);

describe('🔴 O1 · 여행 중은 오래됐어도 맨 위, 나머지는 최신순', () => {
  it('여행 중 A(가장 옛) · 예정 B(최신) · 끝남 C(중간) → A, B, C', () => {
    // 준비
    const A = trip('A', '2026-08-01T00:00:00.000Z', IN);
    const B = trip('B', '2026-09-20T00:00:00.000Z', FUTURE);
    const C = trip('C', '2026-09-01T00:00:00.000Z', PAST);
    const entries = [
      entry(C, 'CONFIRMED'),
      entry(B, 'CONFIRMED'),
      entry(A, 'CONFIRMED'),
    ];

    // 실행
    const ordered = orderMyTrips(entries, TODAY);

    // 단언
    expect(ids(ordered)).toEqual(['A', 'B', 'C']);
  });
});

describe('🔴 O2 · 여행 중이 여럿이면 그 안에서도 같은 비교자', () => {
  it('여행 중 A1(옛)·A2(새) + 예정 B → A2, A1, B', () => {
    const A1 = trip('A1', '2026-07-01T00:00:00.000Z', IN);
    const A2 = trip('A2', '2026-08-01T00:00:00.000Z', IN);
    const B = trip('B', '2026-09-20T00:00:00.000Z', FUTURE);

    const ordered = orderMyTrips(
      [entry(A1, 'CONFIRMED'), entry(B, 'CONFIRMED'), entry(A2, 'CONFIRMED')],
      TODAY
    );

    expect(ids(ordered)).toEqual(['A2', 'A1', 'B']);
  });
});

describe('🔴 O3 · 입력 불변 — 복사본에 정렬한다', () => {
  it('얼린 입력으로 불러도 던지지 않고, 새 배열을 돌려주며, 입력 순서는 그대로다', () => {
    // 준비 — 입력 순서가 결과 순서와 다르게(정렬이 실제로 일어나게)
    const A = trip('A', '2026-08-01T00:00:00.000Z', IN);
    const B = trip('B', '2026-09-20T00:00:00.000Z', FUTURE);
    const C = trip('C', '2026-09-01T00:00:00.000Z', PAST);
    const entries = Object.freeze([
      entry(C, 'CONFIRMED'),
      entry(B, 'CONFIRMED'),
      entry(A, 'CONFIRMED'),
    ]);

    // 실행
    const ordered = orderMyTrips(entries, TODAY);

    // 단언
    expect(ids(ordered)).toEqual(['A', 'B', 'C']);
    expect(ordered).not.toBe(entries as unknown);
    expect(entries.map((e) => e.trip.tripId)).toEqual(['C', 'B', 'A']);
  });
});

describe('🟢 O4 · 판정할 수 없거나 확정이 아니면 고정하지 않는다 (INV-4 · 02a ★9)', () => {
  it.each([
    ['일정 미도착(pending)', (t: Trip) => pendingEntry(t)],
    ['초안(PLANNED)', (t: Trip) => entry(t, 'PLANNED')],
    ['일정 없음·조회 실패(status 없음)', (t: Trip) => entry(t, undefined)],
  ])('기간 안이지만 %s 인 A 는 최신순 자리 그대로', (_label, make) => {
    const A = trip('A', '2026-08-01T00:00:00.000Z', IN);
    const B = trip('B', '2026-09-20T00:00:00.000Z', FUTURE);

    const ordered = orderMyTrips([make(A), entry(B, 'CONFIRMED')], TODAY);

    expect(ids(ordered)).toEqual(['B', 'A']);
  });
});

describe('🔴 O5 · 비교자 주입 — 두 묶음 모두 주입한 순서를 따른다', () => {
  it('제목 오름차순 비교자면 여행 중(가·나) 다음 나머지(다·라)가 각각 제목순', () => {
    const byTitle = (a: Trip, b: Trip) => a.title.localeCompare(b.title);
    const live1 = trip('L1', '2026-09-20T00:00:00.000Z', IN, '나');
    const live2 = trip('L2', '2026-07-01T00:00:00.000Z', IN, '가');
    const rest1 = trip('R1', '2026-09-21T00:00:00.000Z', FUTURE, '라');
    const rest2 = trip('R2', '2026-06-01T00:00:00.000Z', PAST, '다');

    const ordered = orderMyTrips(
      [
        entry(rest1, 'CONFIRMED'),
        entry(live1, 'CONFIRMED'),
        entry(rest2, 'CONFIRMED'),
        entry(live2, 'CONFIRMED'),
      ],
      TODAY,
      byTitle
    );

    expect(ordered.map((t) => t.title)).toEqual(['가', '나', '다', '라']);
  });
});

describe('🔴 O6 · byLatest — 더 최근에 수정된 여행이 앞', () => {
  it('a 가 더 최근이면 음수, 더 옛날이면 양수', () => {
    const newer = trip('N', '2026-09-20T00:00:00.000Z', FUTURE);
    const older = trip('O', '2026-08-01T00:00:00.000Z', FUTURE);

    expect(byLatest(newer, older)).toBeLessThan(0);
    expect(byLatest(older, newer)).toBeGreaterThan(0);
  });
});

// ── PBT ─────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const isoOf = (day: number) =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);
const TODAY_DAY = Date.parse(`${TODAY}T00:00:00Z`) / DAY_MS;

/** 여행 한 건 생성기 — 기간은 오늘 기준 상대 일수(오늘 포함/앞/뒤가 고르게), 일정은 pending 또는 상태. */
const rowArb = fc.record({
  startOffset: fc.integer({ min: -10, max: 10 }),
  length: fc.integer({ min: 0, max: 6 }),
  updatedMinute: fc.integer({ min: 0, max: 100_000 }),
  itinerary: fc.constantFrom<'pending' | ItineraryStatus | undefined>(
    'pending',
    'CONFIRMED',
    'PLANNED',
    undefined
  ),
});

describe('🔴 O7 · PBT — 순열 · 여행 중 전부가 앞 · 묶음 안 최신순 · 입력 불변', () => {
  it('임의 목록에서 성질이 모두 성립한다', () => {
    const hits = { mixed: 0, pending: 0 };

    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 8 }), (rows) => {
        // 준비 — 인덱스를 id 로 써 중복 없는 여행 목록을 만든다.
        const entries: DoneBarEntry[] = rows.map((r, i) => {
          const start = TODAY_DAY + r.startOffset;
          const t = trip(
            `t${i}`,
            new Date(
              Date.UTC(2026, 0, 1) + r.updatedMinute * 60_000
            ).toISOString(),
            { startDate: isoOf(start), endDate: isoOf(start + r.length) }
          );
          return r.itinerary === 'pending'
            ? pendingEntry(t)
            : entry(t, r.itinerary);
        });
        // 오라클 — 정수로 센 여행 중 id 집합(구현의 날짜 문자열 비교와 다른 길)
        const liveIds = new Set(
          rows
            .map((r, i) => ({ r, id: `t${i}` }))
            .filter(
              ({ r }) =>
                r.itinerary === 'CONFIRMED' &&
                r.startOffset <= 0 &&
                r.startOffset + r.length >= 0
            )
            .map(({ id }) => id)
        );
        if (liveIds.size > 0 && liveIds.size < rows.length) hits.mixed += 1;
        if (rows.some((r) => r.itinerary === 'pending')) hits.pending += 1;
        const before = entries.map((e) => e.trip.tripId);

        // 실행
        const ordered = orderMyTrips(entries, TODAY);

        // 단언 — 순열
        expect([...ids(ordered)].sort()).toEqual([...before].sort());
        // 단언 — 앞 k 개가 정확히 여행 중 집합
        const k = liveIds.size;
        expect(new Set(ids(ordered).slice(0, k))).toEqual(liveIds);
        // 단언 — 두 묶음 각각 updatedAt 비증가(최신순)
        for (const group of [ordered.slice(0, k), ordered.slice(k)]) {
          for (let i = 1; i < group.length; i += 1) {
            expect(group[i - 1].updatedAt >= group[i].updatedAt).toBe(true);
          }
        }
        // 단언 — 입력 불변
        expect(entries.map((e) => e.trip.tripId)).toEqual(before);
      }),
      { numRuns: 300 }
    );

    // 생성기가 "여행 중 + 비여행 중이 섞인 목록"과 pending 을 실제로 만들었다(02a ★7).
    expect(hits.mixed).toBeGreaterThan(0);
    expect(hits.pending).toBeGreaterThan(0);
  });
});

// TRIP-1122 · 옛 myTripsOrder.sort.test.ts
describe('정렬 기준 세 가지와 저장값 해석', () => {
  /**
   * TRIP-1122 · AC-7~AC-11·AC-13 — h06 정렬 시트의 세 비교자와 저장값 해석.
   *
   * 규칙(01b 확정):
   *  - 최신순 `byLatest` = updatedAt 내림차순.
   *  - 출발일순 `byStart(today)` = 오늘 이후(startDate ≥ today) 출발을 오름차순으로 먼저, 지난 출발을
   *    내림차순으로 뒤(Figma 보조 문구 "가까운 출발일부터").
   *  - 이름순 `byTitle` = title 한글 가나다순(`localeCompare(…, 'ko')`).
   *  - 셋 모두 주 키가 같으면 tripId 오름차순(결정론).
   *  - 저장값이 'recent'·'start'·'title' 이 아니면 전부 최신순(INV-4).
   *
   * 무엇을 보장하나: 같은 여행 묶음은 어떤 순서로 넣어도 같은 순서로 나온다. 여행 중 고정은 어느
   * 비교자에서도 유지된다(1121 orderMyTrips 에 비교자만 바꿔 넘김).
   *
   * *(개념 — 보조키)* 주 키가 같을 때 순서를 정하는 두 번째 기준. 없으면 동률 두 건이 입력 순서대로
   *   남아, 서버가 목록을 다른 순서로 주면 화면 순서가 흔들린다.
   * *(개념 — 비교자 팩토리)* `byStart(today)` 는 오늘을 받아 비교자를 **돌려주는** 함수다. 비교자는
   *   `(a, b)` 두 인자만 받으므로, 오늘처럼 바깥 값이 필요하면 한 겹 감싼다.
   */

  const TODAY = '2026-09-29';

  function trip(
    tripId: string,
    fields: Partial<Pick<Trip, 'title' | 'startDate' | 'updatedAt'>> = {}
  ): Trip {
    const startDate = fields.startDate ?? '2026-10-10';
    return {
      tripId,
      title: fields.title ?? `${tripId} 여행`,
      startDate,
      endDate: startDate,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '부산', nights: 1 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: fields.updatedAt ?? '2026-09-01T00:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  const ids = (trips: Trip[]) => trips.map((t) => t.tripId);

  describe('🔴 M1 · 최신순 — 수정 시각이 같으면 tripId 오름차순 (AC-7)', () => {
    it('같은 updatedAt 의 b·a 를 넣으면 a, b', () => {
      // 준비
      const same = '2026-09-20T00:00:00.000Z';
      const b = trip('b', { updatedAt: same });
      const a = trip('a', { updatedAt: same });

      // 실행
      const sorted = [b, a].sort(byLatest);

      // 단언
      expect(ids(sorted)).toEqual(['a', 'b']);
    });
  });

  describe('🔴 M2 · 출발일순 — 오늘 이후 가까운 순 먼저, 지난 출발은 가까운 순으로 뒤 (AC-8)', () => {
    it('오늘 출발 S0 · 10-05 S+ · 09-20 S− · 06-10 S−− → S0, S+, S−, S−−', () => {
      // 준비 — 뒤섞어 넣는다(정렬이 실제로 일어나게)
      const s0 = trip('S0', { startDate: '2026-09-29' });
      const sPlus = trip('SP', { startDate: '2026-10-05' });
      const sMinus = trip('SM', { startDate: '2026-09-20' });
      const sMinus2 = trip('SMM', { startDate: '2026-06-10' });

      // 실행
      const sorted = [sMinus2, sPlus, sMinus, s0].sort(byStart(TODAY));

      // 단언 — 오늘 출발은 "오늘 이후" 묶음(≥)의 맨 앞이다
      expect(ids(sorted)).toEqual(['S0', 'SP', 'SM', 'SMM']);
    });
  });

  describe('🔴 M3 · 출발일순 — 출발일이 같으면 tripId 오름차순 (AC-8)', () => {
    it.each([
      ['오늘 이후', '2026-10-05'],
      ['지난 출발', '2026-06-10'],
    ])('%s 묶음에서 같은 출발일 b·a → a, b', (_label, startDate) => {
      const b = trip('b', { startDate });
      const a = trip('a', { startDate });

      const sorted = [b, a].sort(byStart(TODAY));

      expect(ids(sorted)).toEqual(['a', 'b']);
    });
  });

  describe('🔴 M4 · 이름순 — 한글 가나다순, 같으면 tripId 오름차순 (AC-9)', () => {
    it('제주·강릉·부산 → 강릉, 부산, 제주', () => {
      const jeju = trip('j', { title: '제주 여행' });
      const gangneung = trip('g', { title: '강릉 여행' });
      const busan = trip('b', { title: '부산 여행' });

      const sorted = [jeju, gangneung, busan].sort(byTitle);

      expect(sorted.map((t) => t.title)).toEqual([
        '강릉 여행',
        '부산 여행',
        '제주 여행',
      ]);
    });

    it('같은 제목 b·a → a, b', () => {
      const b = trip('b', { title: '부산 여행' });
      const a = trip('a', { title: '부산 여행' });

      const sorted = [b, a].sort(byTitle);

      expect(ids(sorted)).toEqual(['a', 'b']);
    });
  });

  describe("🔴 M5 · 이름순은 'ko' 로케일 규칙이다 — 한글이 라틴보다 앞 (AC-9 · 02a ★15)", () => {
    it('Busan 여행 · 제주 여행 → 제주 여행이 앞 (기본 로케일이면 Busan 이 앞이라 red)', () => {
      const latin = trip('L', { title: 'Busan 여행' });
      const hangul = trip('H', { title: '제주 여행' });

      const sorted = [latin, hangul].sort(byTitle);

      expect(ids(sorted)).toEqual(['H', 'L']);
    });
  });

  describe('🔴 M6 · 출발일순에서도 여행 중은 맨 위 (AC-11)', () => {
    it('여행 중 확정 A(09-28 출발 = 지난 묶음) + 예정 B → A, B', () => {
      // 준비 — A 는 출발일만 보면 "지난 출발"이라 B 뒤로 가야 하지만, 여행 중이라 고정된다.
      const A: Trip = {
        ...trip('A', { startDate: '2026-09-28' }),
        endDate: '2026-10-01',
      };
      const B = trip('B', { startDate: '2026-10-05' });
      const confirmed = (t: Trip): DoneBarEntry => ({
        trip: t,
        itinerary: { status: 'CONFIRMED', generationState: 'COMPLETE' },
      });

      // 실행
      const ordered = orderMyTrips(
        [confirmed(B), confirmed(A)],
        TODAY,
        byStart(TODAY)
      );

      // 단언
      expect(ids(ordered)).toEqual(['A', 'B']);
    });
  });

  describe('🔴 M7 · 저장값 해석 — 세 값 말고는 전부 최신순 (AC-13 · 02a ★14)', () => {
    it.each(['recent', 'start', 'title'] as const)('%s 는 그대로', (value) => {
      expect(parseMyTripsSortKey(value)).toBe(value);
    });

    it.each([
      ['null', null],
      ['undefined(jest-expo 자동 목 모양)', undefined],
      ['빈 문자열', ''],
      ['모르는 값', 'foo'],
      ['대문자 섞임', 'Title'],
      ['전부 대문자', 'TITLE'],
      ['앞 공백', ' title'],
      ['뒤 공백', 'title '],
      ['프로토타입 키 toString', 'toString'],
      ['프로토타입 키 __proto__', '__proto__'],
      ['프로토타입 키 constructor', 'constructor'],
      ['숫자', 1],
      ['객체', {}],
    ])('%s → recent', (_label, raw) => {
      expect(parseMyTripsSortKey(raw)).toBe('recent');
    });
  });

  // ── PBT ─────────────────────────────────────────────────────────────────

  const DAY_MS = 86_400_000;
  const TODAY_DAY = Date.parse(`${TODAY}T00:00:00Z`) / DAY_MS;
  const isoOf = (day: number) =>
    new Date(day * DAY_MS).toISOString().slice(0, 10);

  /** 동률이 실제로 나오게 작은 풀에서 뽑는다(02a ★6). 인덱스가 클수록 최근. */
  const UPDATED_POOL = [
    '2026-09-01T00:00:00.000Z',
    '2026-09-10T00:00:00.000Z',
    '2026-09-20T00:00:00.000Z',
  ];
  /** 한글 음절 + 공백만 — 이 범위에서 ko 순서 == 코드포인트 순서(02a ★7 · §5 실측). */
  const TITLE_POOL = [
    '강릉 여행',
    '부산 여행',
    '제주 여행',
    '부산',
    '제주도 여행',
  ];

  const rowArb = fc.record({
    updatedIdx: fc.integer({ min: 0, max: UPDATED_POOL.length - 1 }),
    startOffset: fc.integer({ min: -3, max: 3 }),
    titleIdx: fc.integer({ min: 0, max: TITLE_POOL.length - 1 }),
  });
  type Row = { updatedIdx: number; startOffset: number; titleIdx: number };

  /** 행 목록 + 그 인덱스의 임의 순열(넣는 순서). */
  const caseArb = fc.array(rowArb, { maxLength: 8 }).chain((rows) =>
    fc.tuple(
      fc.constant(rows),
      fc.shuffledSubarray(
        rows.map((_, i) => i),
        { minLength: rows.length, maxLength: rows.length }
      )
    )
  );

  const idOf = (i: number) => `t${i}`; // maxLength 8 → t0..t7, 문자열 비교 = 숫자 비교
  const cmpNum = (x: number, y: number) => (x < y ? -1 : x > y ? 1 : 0);
  const cmpStr = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

  /** 오라클 — 정수 오프셋·풀 인덱스·코드포인트로 계산한 기대 id 순서(구현과 다른 길). */
  function oracle(
    kind: 'latest' | 'start' | 'title',
    rows: readonly Row[]
  ): string[] {
    const indexed = rows.map((r, i) => ({ r, i }));
    const byId = (a: { i: number }, b: { i: number }) =>
      cmpStr(idOf(a.i), idOf(b.i));
    if (kind === 'latest') {
      return indexed
        .sort((a, b) => cmpNum(b.r.updatedIdx, a.r.updatedIdx) || byId(a, b))
        .map(({ i }) => idOf(i));
    }
    if (kind === 'title') {
      return indexed
        .sort(
          (a, b) =>
            cmpStr(TITLE_POOL[a.r.titleIdx], TITLE_POOL[b.r.titleIdx]) ||
            byId(a, b)
        )
        .map(({ i }) => idOf(i));
    }
    const upcoming = indexed
      .filter(({ r }) => r.startOffset >= 0)
      .sort((a, b) => cmpNum(a.r.startOffset, b.r.startOffset) || byId(a, b));
    const past = indexed
      .filter(({ r }) => r.startOffset < 0)
      .sort((a, b) => cmpNum(b.r.startOffset, a.r.startOffset) || byId(a, b));
    return [...upcoming, ...past].map(({ i }) => idOf(i));
  }

  function tripOf(r: Row, i: number): Trip {
    return trip(idOf(i), {
      title: TITLE_POOL[r.titleIdx],
      startDate: isoOf(TODAY_DAY + r.startOffset),
      updatedAt: UPDATED_POOL[r.updatedIdx],
    });
  }

  function hasTie<T>(values: T[]): boolean {
    return new Set(values).size < values.length;
  }

  describe('🔴 M8 · PBT — 어떤 순서로 넣어도 오라클과 같은 순서 · 반대칭 (AC-10)', () => {
    it.each([
      ['최신순', 'latest', () => byLatest],
      ['출발일순', 'start', () => byStart(TODAY)],
      ['이름순', 'title', () => byTitle],
    ] as const)('%s', (_label, kind, makeCompare) => {
      const compare = makeCompare();
      const hits = {
        latestTie: 0,
        startTie: 0,
        titleTie: 0,
        startMixed: 0,
        startToday: 0,
      };

      fc.assert(
        fc.property(caseArb, ([rows, order]) => {
          // 준비 — id 는 원래 행 번호로 고정하고, 넣는 순서만 섞는다.
          const input = order.map((i) => tripOf(rows[i], i));
          if (hasTie(rows.map((r) => r.updatedIdx))) hits.latestTie += 1;
          if (hasTie(rows.map((r) => r.startOffset))) hits.startTie += 1;
          if (hasTie(rows.map((r) => r.titleIdx))) hits.titleTie += 1;
          if (
            rows.some((r) => r.startOffset >= 0) &&
            rows.some((r) => r.startOffset < 0)
          ) {
            hits.startMixed += 1;
          }
          if (rows.some((r) => r.startOffset === 0)) hits.startToday += 1;

          // 실행
          const sorted = [...input].sort(compare);

          // 단언 — 넣은 순서와 무관하게 오라클 순서
          expect(ids(sorted)).toEqual(oracle(kind, rows));
          // 단언 — 반대칭 · 자기 자신과는 0 (`=== 0` 비교 — toBe 는 +0 과 -0 을 다르게 본다)
          for (const a of input) {
            expect(compare(a, a) === 0).toBe(true);
            for (const b of input) {
              const sum = Math.sign(compare(a, b)) + Math.sign(compare(b, a));
              expect(sum === 0).toBe(true);
            }
          }
        }),
        { numRuns: 300 }
      );

      // 생성기가 동률·묶음 섞임·오늘 출발을 실제로 만들었다(02a ★6).
      expect(hits.latestTie).toBeGreaterThan(0);
      expect(hits.startTie).toBeGreaterThan(0);
      expect(hits.titleTie).toBeGreaterThan(0);
      expect(hits.startMixed).toBeGreaterThan(0);
      expect(hits.startToday).toBeGreaterThan(0);
    });
  });
});
