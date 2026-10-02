import fc from 'fast-check';

import type { Trip } from '@/shared/api/index.schemas';

import {
  buildMonthLegends,
  markedDaysOfMonth,
  type LegendRow,
} from './recordsCalendar';

/**
 * TRIP-1084 · j07 캘린더 아래 legend 파생 — 이 달 여행 고르기 → 일정 0일 여행 빼기 → 같은 기간 묶기
 * → 정렬 → 앞 3줄과 숨긴 줄 수 (US-REC-14 · BR-U5-49 · INV-4 · 사용자 요청 R2 · Figma 4699:2630).
 *
 * 무엇을 보장하나:
 *  - 이 달에 걸친 여행만 줄이 된다(달 경계 여행은 양쪽 달 — 마킹과 같은 기준).
 *  - `itineraryDayCount === 0` 인 여행만 빠진다(undefined 는 남는다). 마킹은 그대로다.
 *  - 기간(시작·종료)이 같은 여행 2건 이상은 한 줄(`kind: 'group'`)이 되고, 대표는 입력 순서 첫째다.
 *  - 줄은 시작일 내림차순 → 종료일 내림차순이다.
 *  - 3줄을 넘으면 넘친 만큼이 `hiddenCount` 다(숨긴 줄을 개수 없이 버리지 않는다 — INV-4).
 *  - 속성: 어떤 목록이든 보이는 줄 ≤ 3, 보이는 + 숨긴 = 묶은 뒤 전체, 여행이 사라지거나 겹치지 않는다.
 *
 * 3동작 뼈대: 준비 = Trip 목록·달 → 실행 = buildMonthLegends → 단언 = 줄 모양·순서·숨긴 수.
 */

/**
 * required 필드를 채운 최소 Trip. `itineraryDayCount` 기본값은 2 — 0 이 기본이면 모든 여행이 빠져
 * "3줄 이하" 류 단언이 공짜로 통과한다. 필드가 **없는** 여행은 `'absent'` 로 만든다(기존 라우트
 * 픽스처와 같은 모양). `undefined` 를 넘기면 기본값 2 로 바뀌어 버리므로 쓰지 않는다.
 */
function trip(
  tripId: string,
  title: string,
  startDate: string | null,
  endDate: string | null,
  itineraryDayCount: number | 'absent' = 2
): Trip {
  const base = {
    tripId,
    title,
    startDate,
    endDate,
    status: 'PLANNED',
    party: 2,
    destinations: [],
    preferenceSnapshot: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  return (itineraryDayCount === 'absent'
    ? base
    : { ...base, itineraryDayCount }) as unknown as Trip;
}

/** 줄을 한눈에 비교할 문자열로 — 개별 줄은 tripId, 묶음 줄은 `key[구성원 id…]`. */
function summarize(rows: LegendRow[]): string[] {
  return rows.map((row) =>
    row.kind === 'group'
      ? `${row.key}[${row.members.map((m) => m.tripId).join(',')}]`
      : row.tripId
  );
}

/** Figma 4699:2630 의 9월 — 서울 9.28–9.30 6건 · 9.28–9.29 서울 3건+강진 1건 · 부산 · 제주 · 강릉. */
const SEOUL = '서울특별시 여행';
const FIGMA_SEPTEMBER: Trip[] = [
  trip('gn', '강릉 여행', '2026-09-01', '2026-09-02'),
  trip('s1', SEOUL, '2026-09-28', '2026-09-30'),
  trip('k1', SEOUL, '2026-09-28', '2026-09-29'),
  trip('s2', SEOUL, '2026-09-28', '2026-09-30'),
  trip('bs', '부산 여행', '2026-09-12', '2026-09-14'),
  trip('k2', '강진군 여행', '2026-09-28', '2026-09-29'),
  trip('s3', SEOUL, '2026-09-28', '2026-09-30'),
  trip('k3', SEOUL, '2026-09-28', '2026-09-29'),
  trip('s4', SEOUL, '2026-09-28', '2026-09-30'),
  trip('jj', '제주 여행', '2026-09-03', '2026-09-05'),
  trip('s5', SEOUL, '2026-09-28', '2026-09-30'),
  trip('k4', SEOUL, '2026-09-28', '2026-09-29'),
  trip('s6', SEOUL, '2026-09-28', '2026-09-30'),
];

describe('🔴 TRIP-1084 · buildMonthLegends — 이 달 여행만 (AC-1)', () => {
  it('9월에 걸친 여행만 줄이 되고, 8.30–9.2 여행은 8월과 9월 양쪽에 나온다', () => {
    // 준비: 달 경계 여행 · 9월 안 여행 · 10월에만 있는 여행.
    const trips = [
      trip('edge', '경계 여행', '2026-08-30', '2026-09-02'),
      trip('bs', '부산 여행', '2026-09-12', '2026-09-14'),
      trip('oct', '시월 여행', '2026-10-05', '2026-10-06'),
    ];

    // 실행 / 단언: 9월엔 시작일 늦은 부산이 위, 10월 여행은 없다.
    expect(summarize(buildMonthLegends(trips, '2026-09').rows)).toEqual([
      'bs',
      'edge',
    ]);
    expect(summarize(buildMonthLegends(trips, '2026-08').rows)).toEqual([
      'edge',
    ]);
    expect(summarize(buildMonthLegends(trips, '2026-10').rows)).toEqual([
      'oct',
    ]);
  });
});

describe('🔴 TRIP-1084 · 일정 0일 여행 제외 (AC-2 · 결정 1 · Q4)', () => {
  it('itineraryDayCount 0 인 여행만 빠지고 undefined 는 남는다 · 그 날 마킹은 그대로다', () => {
    // 준비: 작성중(0) · 일정 있음(3) · 필드 없음(undefined — 모르는 값은 숨기지 않는다).
    const trips = [
      trip('draft', '작성중 여행', '2026-09-12', '2026-09-14', 0),
      trip('ok', '제주 여행', '2026-09-03', '2026-09-05', 3),
      trip('unknown', '강릉 여행', '2026-09-01', '2026-09-02', 'absent'),
    ];
    // 앵커 — 세 번째 픽스처에 필드가 정말 없다(기본값에 삼켜지면 undefined 분기를 안 밟는다).
    expect(trips[2]).not.toHaveProperty('itineraryDayCount');

    // 실행
    const legends = buildMonthLegends(trips, '2026-09');

    // 단언: legend 에서는 빠지고, 캘린더 마킹(BR-U5-49 "모두")은 그 날을 계속 칠한다.
    expect(summarize(legends.rows)).toEqual(['ok', 'unknown']);
    expect(markedDaysOfMonth(trips, '2026-09')).toContain('2026-09-13');
  });

  it('빠진 여행은 묶음 수에도 끼지 않는다 — 같은 기간 2건 중 1건이 0 이면 개별 줄 하나다', () => {
    const trips = [
      trip('draft', '서울특별시 여행', '2026-09-28', '2026-09-30', 0),
      trip('real', '서울특별시 여행', '2026-09-28', '2026-09-30', 3),
    ];

    const { rows } = buildMonthLegends(trips, '2026-09');

    expect(rows).toEqual([
      {
        kind: 'trip',
        tripId: 'real',
        title: '서울특별시 여행',
        dateRangeLabel: '9.28–9.30',
        nightsLabel: '2박 3일',
      },
    ]);
  });
});

describe('🔴 TRIP-1084 · 같은 기간 묶음 · 정렬 · 자르기 (AC-3 · AC-4 · AC-5)', () => {
  it('Figma 9월 13건은 묶음 2줄 + 개별 3줄 = 5줄이 되고, 앞 3줄 뒤 2줄이 숨는다', () => {
    // 실행
    const legends = buildMonthLegends(FIGMA_SEPTEMBER, '2026-09');

    // 단언 ① 줄 순서 — 시작일 내림차순, 같은 9.28 시작이면 종료일 늦은 9.30 이 위.
    //         묶음 구성원은 입력 순서 그대로(강진 k2 가 서울 사이에 끼어 있다).
    expect(summarize(legends.rows)).toEqual([
      '2026-09-28_2026-09-30[s1,s2,s3,s4,s5,s6]',
      '2026-09-28_2026-09-29[k1,k2,k3,k4]',
      'bs',
      'jj',
      'gn',
    ]);
    // 단언 ② 묶음은 1줄로 센다 — 5줄 중 3줄이 보이고 2줄이 숨는다.
    expect(legends.hiddenCount).toBe(2);
    // 단언 ③ 묶음 줄 객체 통째 — 대표 제목·기간 라벨(연도 없음)·박수·구성원 카드.
    const seoulCard = (tripId: string) => ({
      tripId,
      title: SEOUL,
      dateRangeLabel: '9.28–9.30',
      nightsLabel: '2박 3일',
    });
    expect(legends.rows[0]).toEqual({
      kind: 'group',
      key: '2026-09-28_2026-09-30',
      representativeTitle: SEOUL,
      dateRangeLabel: '9.28–9.30',
      nightsLabel: '2박 3일',
      members: ['s1', 's2', 's3', 's4', 's5', 's6'].map(seoulCard),
    });
    // 단언 ④ 개별 줄 객체 통째 — 지금 legend 행과 같은 라벨.
    expect(legends.rows[2]).toEqual({
      kind: 'trip',
      tripId: 'bs',
      title: '부산 여행',
      dateRangeLabel: '9.12–9.14',
      nightsLabel: '2박 3일',
    });
  });

  it('대표는 입력 순서 첫째다 — 제목이 달라도 기간이 같으면 묶이고, 강진이 먼저면 강진이 대표다', () => {
    const trips = [
      trip('k2', '강진군 여행', '2026-09-28', '2026-09-29'),
      trip('k1', SEOUL, '2026-09-28', '2026-09-29'),
    ];

    const { rows } = buildMonthLegends(trips, '2026-09');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'group',
      key: '2026-09-28_2026-09-29',
      representativeTitle: '강진군 여행',
      dateRangeLabel: '9.28–9.29',
      nightsLabel: '1박 2일',
    });
    expect(summarize(rows)).toEqual(['2026-09-28_2026-09-29[k2,k1]']);
  });

  it('시작일이 같으면 종료일이 늦은 쪽이 위다 — 입력 순서가 반대여도', () => {
    // 준비: 9.28–9.29 가 먼저 들어온다(입력 순서대로 두면 틀린다).
    const trips = [
      trip('short', '강진군 여행', '2026-09-28', '2026-09-29'),
      trip('long', SEOUL, '2026-09-28', '2026-09-30'),
    ];

    // 실행 / 단언
    expect(summarize(buildMonthLegends(trips, '2026-09').rows)).toEqual([
      'long',
      'short',
    ]);
  });

  it('줄이 3개 이하면 숨긴 줄이 0 이고, 이 달 여행이 없으면 빈 목록이다', () => {
    const three = [
      trip('a', 'A', '2026-09-01', '2026-09-02'),
      trip('b', 'B', '2026-09-10', '2026-09-11'),
      trip('c', 'C', '2026-09-20', '2026-09-21'),
    ];

    expect(buildMonthLegends(three, '2026-09')).toMatchObject({
      hiddenCount: 0,
    });
    expect(summarize(buildMonthLegends(three, '2026-09').rows)).toEqual([
      'c',
      'b',
      'a',
    ]);
    expect(buildMonthLegends(three, '2026-11')).toEqual({
      rows: [],
      hiddenCount: 0,
    });
  });
});

describe('🔴 TRIP-1084 · 반쪽 방어 (AC-6)', () => {
  it('null·원소 null·날짜 결측에도 던지지 않고 정상 여행만 줄이 된다', () => {
    const dirty = [
      null,
      trip('ok', '정상 여행', '2026-09-05', '2026-09-06'),
      trip('nodate', '날짜 없음', null, null),
      trip('half', '시작만', '2026-09-05', null),
    ] as unknown as Trip[];

    expect(buildMonthLegends(null, '2026-09')).toEqual({
      rows: [],
      hiddenCount: 0,
    });
    expect(buildMonthLegends(undefined, '2026-09')).toEqual({
      rows: [],
      hiddenCount: 0,
    });
    expect(summarize(buildMonthLegends(dirty, '2026-09').rows)).toEqual(['ok']);
  });
});

// ── 속성(fast-check) — 기대값은 전부 입력에서 따로 센다(함수 결과를 되읽지 않는다) ─────────────
// *(개념)* fast-check 는 무작위 입력을 수백 개 만들어 "항상 참이어야 할 성질"을 검사하고, 깨지면
// 가장 작은 반례로 줄여 보여 준다. 날짜를 넓게 뽑으면 같은 기간이 거의 안 나와 묶음 분기를 안 밟으므로,
// 기간은 작은 풀에서 뽑는다(달 경계 걸침·같은 시작 다른 종료·당일치기·날짜 없음 포함).
const PERIODS: readonly (readonly [string | null, string | null])[] = [
  ['2026-08-30', '2026-08-30'],
  ['2026-08-30', '2026-09-01'],
  ['2026-09-01', '2026-09-02'],
  ['2026-09-12', '2026-09-14'],
  ['2026-09-28', '2026-09-29'],
  ['2026-09-28', '2026-09-30'],
  ['2026-09-30', '2026-10-02'],
  ['2026-10-05', '2026-10-06'],
  [null, null],
];
const MONTHS = ['2026-08', '2026-09', '2026-10'] as const;

const specArb = fc.record({
  period: fc.constantFrom(...PERIODS),
  count: fc.constantFrom<number | 'absent'>(0, 1, 3, 'absent'),
  title: fc.constantFrom(SEOUL, '강진군 여행', '부산 여행'),
});
const tripsArb = fc
  .array(fc.option(specArb, { nil: null, freq: 10 }), { maxLength: 12 })
  .map((specs) =>
    specs.map((spec, i) =>
      spec === null
        ? null
        : trip(`t${i}`, spec.title, spec.period[0], spec.period[1], spec.count)
    )
  );

/** 오라클 — 이 달에 걸치나(문자열 비교, 구현의 마킹 함수를 쓰지 않는다). */
function overlapsMonth(t: Trip, ym: string): boolean {
  const start = t.startDate ?? null;
  const end = t.endDate ?? null;
  if (start === null || end === null || start > end) return false;
  return start <= `${ym}-31` && end >= `${ym}-01`;
}
const periodOf = (t: Trip): string => `${t.startDate}_${t.endDate}`;
const rowMemberIds = (row: LegendRow): string[] =>
  row.kind === 'group' ? row.members.map((m) => m.tripId) : [row.tripId];

/** 분기 도달 카운터 — 속성이 묶음·자르기·제외·달 밖·undefined 를 실제로 밟았는지 P2 가 확인한다. */
const reached = {
  group: 0,
  hidden: 0,
  excludedZero: 0,
  outOfMonth: 0,
  undefinedKept: 0,
};

describe('🔴 TRIP-1084 · buildMonthLegends 속성 (AC-7)', () => {
  it('보이는 줄 ≤ 3 · 보이는 + 숨긴 = 묶은 뒤 전체 · 여행이 사라지거나 겹치지 않는다 · 정렬·대표 규칙', () => {
    fc.assert(
      fc.property(tripsArb, fc.constantFrom(...MONTHS), (trips, ym) => {
        // 준비 — 기대값을 입력에서 따로 센다.
        const real = trips.filter((t): t is Trip => t !== null);
        const inMonth = real.filter((t) => overlapsMonth(t, ym));
        const eligible = inMonth.filter((t) => t.itineraryDayCount !== 0);
        const expectedPeriods = new Set(eligible.map(periodOf));
        const expectedTotal = expectedPeriods.size;

        // 실행
        const { rows, hiddenCount } = buildMonthLegends(trips, ym);
        const visible = rows.length - hiddenCount;

        // 단언 ① 보이는 줄 ≤ 3, 그리고 정확히 min(3, 전체).
        expect(hiddenCount).toBeGreaterThanOrEqual(0);
        expect(visible).toBeLessThanOrEqual(3);
        expect(visible).toBe(Math.min(3, expectedTotal));
        // 단언 ② 보이는 + 숨긴 = 묶은 뒤 전체(기간 수를 따로 셌다).
        expect(rows.length).toBe(expectedTotal);
        expect(hiddenCount).toBe(Math.max(0, expectedTotal - 3));
        // 단언 ③ 모든 자격 여행이 정확히 한 번씩 어딘가의 줄에 있다.
        expect(rows.flatMap(rowMemberIds).sort()).toEqual(
          eligible.map((t) => t.tripId).sort()
        );
        // 단언 ④·⑥ 줄마다 기간 하나 · 묶음은 2건 이상 · 개별 줄은 그 기간의 유일한 여행 · 대표 규칙.
        const keys: string[] = [];
        for (const row of rows) {
          const ids = rowMemberIds(row);
          const samePeriod = eligible.filter((t) => ids.includes(t.tripId));
          const periods = new Set(samePeriod.map(periodOf));
          expect(periods.size).toBe(1);
          const [period] = [...periods];
          const allOfPeriod = eligible.filter((t) => periodOf(t) === period);
          if (row.kind === 'group') {
            expect(row.key).toBe(period);
            expect(row.members.length).toBeGreaterThanOrEqual(2);
            expect(ids).toEqual(allOfPeriod.map((t) => t.tripId));
            expect(row.representativeTitle).toBe(allOfPeriod[0].title);
          } else {
            expect(allOfPeriod).toHaveLength(1);
          }
          keys.push(period);
        }
        // 단언 ⑤ 기간 키가 엄격 내림차순(시작일 → 종료일, 'YYYY-MM-DD_YYYY-MM-DD' 사전순).
        for (let i = 1; i < keys.length; i++) {
          expect(keys[i - 1] > keys[i]).toBe(true);
        }

        // 분기 도달 기록(P2).
        if (rows.some((r) => r.kind === 'group')) reached.group++;
        if (hiddenCount > 0) reached.hidden++;
        if (inMonth.some((t) => t.itineraryDayCount === 0))
          reached.excludedZero++;
        if (real.some((t) => !overlapsMonth(t, ym))) reached.outOfMonth++;
        if (eligible.some((t) => t.itineraryDayCount === undefined))
          reached.undefinedKept++;
      }),
      { numRuns: 300 }
    );
  });

  it('공허 방지 — 위 속성이 묶음·숨김·0 제외·달 밖·undefined 유지 분기를 실제로 밟았다', () => {
    // 위 it 가 먼저 실행된다(같은 describe, 선언 순서). 0 이면 생성기가 약해져 속성이 공허해진 것이다.
    expect(reached.group).toBeGreaterThan(0);
    expect(reached.hidden).toBeGreaterThan(0);
    expect(reached.excludedZero).toBeGreaterThan(0);
    expect(reached.outOfMonth).toBeGreaterThan(0);
    expect(reached.undefinedKept).toBeGreaterThan(0);
  });
});
