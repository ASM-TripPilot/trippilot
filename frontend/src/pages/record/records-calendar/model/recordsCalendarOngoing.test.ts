import fc from 'fast-check';

import type { ItineraryStatus, Trip } from '@/shared/api/index.schemas';

import {
  canOpenTripRecords,
  openableTripIds,
  pickOngoingTrip,
  type OngoingTripEntry,
} from './recordsCalendar';

/**
 * TRIP-1120 · j07 진행 중 여행 카드 1장 고르기 + legend `›` 를 달 여행 집합 (US-REC-14 · INV-3 · INV-4).
 *
 * *(개념)* 페이지는 여행마다 일정 조회 결과를 세 값으로 접어 넘긴다 — 확정 여부(`'CONFIRMED'` 등),
 * 404 = 일정 없음(`undefined`), 아직 모름(`'unknown'`: 대기·404 아닌 실패). 이 파일의 두 함수는 그
 * 결과만 보고 판정한다(시계·네트워크·화면을 모른다).
 *
 * 무엇을 보장하나:
 *  - AC-1 초안·미래·지난 여행이 "여행 중" 카드로 뜨지 않는다. 확정 + 오늘이 기간 안인 여행만 카드가 된다.
 *  - AC-2 여러 개면 시작일 최신 → 종료일 최신 → tripId 순으로 **늘 같은 한 장**(입력 순서 무관, 입력 불변).
 *  - AC-3 오늘이 기간 안인 여행 중 하나라도 모르면 카드를 그리지 않는다. 기간 밖 여행을 몰라도 막지 않는다.
 *  - AC-4 `2026.6.10–6.12` · `2일차` 라벨(해넘김·월말 포함).
 *  - AC-5 INV-3 — 카드 글자에 소요시간이 없다.
 *  - AC-6 `›` 집합은 누르면 실제로 이동하는 여행(`canOpenTripRecords`)과 정확히 같다.
 *
 * 3동작 뼈대: 준비 = 여행 + 일정 상태 → 실행 = pickOngoingTrip / openableTripIds → 단언 = 카드 VM / 집합.
 */

const TODAY = '2026-06-11';

/** required 필드를 채운 최소 Trip. 서버 `status` 는 일부러 받는다 — 판정이 그 값을 쓰면 잡히도록. */
function trip(
  tripId: string,
  startDate: string,
  endDate: string,
  over: Partial<Trip> = {}
): Trip {
  return {
    tripId,
    title: `${tripId} 여행`,
    startDate,
    endDate,
    status: 'PLANNED',
    party: 2,
    destinations: [],
    preferenceSnapshot: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  } as unknown as Trip;
}

function entry(
  t: Trip,
  itinerary: ItineraryStatus | undefined | 'unknown'
): OngoingTripEntry {
  return { trip: t, itinerary };
}

// ── AC-1 정의 ──────────────────────────────────────────────────────────────

describe('🔴 AC-1 · 진행 중 = 확정 × 오늘이 기간 안', () => {
  it('기간 안 확정 여행 1건이면 그 여행 카드가 된다(서버 status 가 ENDED 여도)', () => {
    // 준비 — 서버 status 는 적대적으로 ENDED(판정은 일정 확정 × 날짜만 본다).
    const now = trip('t-now', '2026-06-10', '2026-06-12', {
      title: '부산 여행',
      status: 'ENDED',
    });

    // 실행
    const card = pickOngoingTrip([entry(now, 'CONFIRMED')], TODAY);

    // 단언
    expect(card).toEqual({
      tripId: 't-now',
      title: '부산 여행',
      dateRangeLabel: '2026.6.10–6.12',
      dayLabel: '2일차',
    });
  });

  it.each([
    [
      '같은 기간 미확정 초안(PLANNED)',
      'PLANNED' as const,
      '2026-06-10',
      '2026-06-12',
    ],
    ['같은 기간 일정 없음(404)', undefined, '2026-06-10', '2026-06-12'],
    ['미래 확정 여행', 'CONFIRMED' as const, '2026-06-20', '2026-06-22'],
    ['지난 확정 여행', 'CONFIRMED' as const, '2026-06-01', '2026-06-03'],
  ])('%s 은 카드가 되지 않는다(null)', (_label, itinerary, start, end) => {
    // 준비 — 초안은 서버 status 를 ACTIVE 로(날짜만 보는 서버 판정을 믿으면 잡힌다).
    const t = trip('t-x', start, end, { status: 'ACTIVE' });

    expect(pickOngoingTrip([entry(t, itinerary)], TODAY)).toBeNull();
  });

  it('여행이 없으면 null', () => {
    expect(pickOngoingTrip([], TODAY)).toBeNull();
  });
});

// ── AC-2 1장 선택 ──────────────────────────────────────────────────────────

describe('🔴 AC-2 · 여러 개면 시작일 최신 → 종료일 최신 → tripId 오름차순 한 장', () => {
  it('시작일이 다르면 늦게 시작한 여행', () => {
    const early = trip('a', '2026-06-09', '2026-06-13');
    const late = trip('b', '2026-06-11', '2026-06-11');

    const card = pickOngoingTrip(
      [entry(early, 'CONFIRMED'), entry(late, 'CONFIRMED')],
      TODAY
    );

    expect(card?.tripId).toBe('b');
  });

  it('시작일이 같으면 늦게 끝나는 여행', () => {
    const short = trip('a', '2026-06-10', '2026-06-11');
    const long = trip('b', '2026-06-10', '2026-06-13');

    const card = pickOngoingTrip(
      [entry(long, 'CONFIRMED'), entry(short, 'CONFIRMED')],
      TODAY
    );

    expect(card?.tripId).toBe('b');
  });

  it('시작·종료가 모두 같으면 tripId 가 작은 여행(입력 순서와 무관)', () => {
    const x = trip('t-b', '2026-06-10', '2026-06-12');
    const y = trip('t-a', '2026-06-10', '2026-06-12');

    expect(
      pickOngoingTrip([entry(x, 'CONFIRMED'), entry(y, 'CONFIRMED')], TODAY)
        ?.tripId
    ).toBe('t-a');
    expect(
      pickOngoingTrip([entry(y, 'CONFIRMED'), entry(x, 'CONFIRMED')], TODAY)
        ?.tripId
    ).toBe('t-a');
  });

  it('입력 배열과 원소를 바꾸지 않는다', () => {
    // 준비 — 얼려 두고(제자리 sort 는 throw) 사본과 비교한다.
    const input = [
      entry(trip('a', '2026-06-09', '2026-06-13'), 'CONFIRMED'),
      entry(trip('b', '2026-06-11', '2026-06-11'), 'CONFIRMED'),
    ];
    const before = JSON.stringify(input);
    Object.freeze(input);
    input.forEach((e) => Object.freeze(e));

    // 실행
    pickOngoingTrip(input, TODAY);

    // 단언
    expect(JSON.stringify(input)).toBe(before);
  });
});

// ── AC-3 모름 차단 ─────────────────────────────────────────────────────────

describe('🔴 AC-3 · 오늘이 기간 안인 여행을 하나라도 모르면 카드 없음', () => {
  const now = trip('t-now', '2026-06-10', '2026-06-12');

  it('기간 안 다른 여행의 일정을 모르면 확정 여행이 있어도 null', () => {
    const other = trip('t-other', '2026-06-11', '2026-06-11');

    expect(
      pickOngoingTrip([entry(now, 'CONFIRMED'), entry(other, 'unknown')], TODAY)
    ).toBeNull();
  });

  it('자기 일정을 모르면 null(날짜만으로 먼저 그리지 않는다)', () => {
    expect(pickOngoingTrip([entry(now, 'unknown')], TODAY)).toBeNull();
  });

  it('기간 밖(미래·지난) 여행을 모르는 것은 막지 않는다', () => {
    const future = trip('t-fut', '2026-06-20', '2026-06-22');
    const past = trip('t-past', '2026-06-01', '2026-06-03');

    const card = pickOngoingTrip(
      [
        entry(future, 'unknown'),
        entry(now, 'CONFIRMED'),
        entry(past, 'unknown'),
      ],
      TODAY
    );

    expect(card?.tripId).toBe('t-now');
  });

  it('기간 안 초안(PLANNED)·일정 없음(404)은 "아는 값"이라 막지 않는다', () => {
    const draft = trip('t-draft', '2026-06-11', '2026-06-11');
    const none = trip('t-none', '2026-06-10', '2026-06-11');

    const card = pickOngoingTrip(
      [
        entry(draft, 'PLANNED'),
        entry(none, undefined),
        entry(now, 'CONFIRMED'),
      ],
      TODAY
    );

    expect(card?.tripId).toBe('t-now');
  });
});

// ── AC-4 라벨 ──────────────────────────────────────────────────────────────

describe('🔴 AC-4 · 기간 라벨 + N일차(시작 당일 1일차)', () => {
  it.each([
    ['2026-06-10', '1일차'],
    ['2026-06-11', '2일차'],
    ['2026-06-12', '3일차'],
  ])('6.10–6.12 여행, 오늘 %s → %s', (today, dayLabel) => {
    const t = trip('t', '2026-06-10', '2026-06-12');

    expect(pickOngoingTrip([entry(t, 'CONFIRMED')], today)).toEqual({
      tripId: 't',
      title: 't 여행',
      dateRangeLabel: '2026.6.10–6.12',
      dayLabel,
    });
  });

  it('해를 넘기는 여행은 양쪽 연도를 쓰고 일차도 해를 넘겨 센다', () => {
    const t = trip('t', '2026-12-30', '2027-01-02');

    const card = pickOngoingTrip([entry(t, 'CONFIRMED')], '2027-01-01');

    expect(card?.dateRangeLabel).toBe('2026.12.30–2027.1.2');
    expect(card?.dayLabel).toBe('3일차');
  });

  it('월말을 넘는 일차 — 1/31 시작, 오늘 2/1 → 2일차', () => {
    const t = trip('t', '2026-01-31', '2026-02-02');

    expect(
      pickOngoingTrip([entry(t, 'CONFIRMED')], '2026-02-01')?.dayLabel
    ).toBe('2일차');
  });
});

// ── AC-2 · AC-3 · AC-5 속성 ────────────────────────────────────────────────

/** 테스트 쪽 오라클 — 구현과 다른 길(명시적 비교 루프)로 고른 tripId. */
function oracle(
  entries: readonly OngoingTripEntry[],
  today: string
): string | null {
  const inRange = entries.filter(
    (e) => e.trip.startDate <= today && today <= e.trip.endDate
  );
  if (inRange.some((e) => e.itinerary === 'unknown')) return null;
  const live = inRange.filter((e) => e.itinerary === 'CONFIRMED');
  let best: Trip | null = null;
  for (const { trip: t } of live) {
    if (best === null) {
      best = t;
      continue;
    }
    if (t.startDate !== best.startDate) {
      if (t.startDate > best.startDate) best = t;
    } else if (t.endDate !== best.endDate) {
      if (t.endDate > best.endDate) best = t;
    } else if (t.tripId < best.tripId) {
      best = t;
    }
  }
  return best?.tripId ?? null;
}

const DURATION_TEXT = /\d+\s*(분|시간)|소요/;

describe('🔴 AC-2·3·5 · 속성 — 오라클과 같고, 순서를 섞어도 같고, 소요시간이 없다', () => {
  it('무작위 여행 목록에서 결과 = 오라클, 순열에도 불변, VM 에 소요시간 없음(생성기 적중 확인)', () => {
    // 오늘 6/11 기준 지난(6/9–6/10)·기간 안·미래(6/12–) 가 모두 나오도록 좁은 풀.
    const STARTS = ['2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'];
    const ENDS = ['2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13'];
    const entryArb = fc
      .record({
        tripId: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'),
        s: fc.constantFrom(...STARTS),
        e: fc.constantFrom(...ENDS),
        status: fc.constantFrom('PLANNED', 'ACTIVE', 'ENDED'),
        itinerary: fc.constantFrom<ItineraryStatus | undefined | 'unknown'>(
          'CONFIRMED',
          'PLANNED',
          undefined,
          'unknown'
        ),
      })
      .map(({ tripId, s, e, status, itinerary }) =>
        entry(
          trip(tripId, s <= e ? s : e, s <= e ? e : s, {
            status: status as Trip['status'],
          }),
          itinerary
        )
      );
    const listAndShuffle = fc
      .uniqueArray(entryArb, { selector: (x) => x.trip.tripId, maxLength: 6 })
      .chain((list) =>
        fc.tuple(
          fc.constant(list),
          fc.shuffledSubarray(list, {
            minLength: list.length,
            maxLength: list.length,
          })
        )
      );

    // 생성기 공백 확인용 적중 카운터(문제로그 2026-08-02).
    const hits = {
      card: 0,
      blockedByUnknown: 0,
      tieById: 0,
      outsideUnknownCard: 0,
    };

    fc.assert(
      fc.property(listAndShuffle, ([list, shuffled]) => {
        const expected = oracle(list, TODAY);
        const card = pickOngoingTrip(list, TODAY);

        expect(card?.tripId ?? null).toBe(expected);
        expect(pickOngoingTrip(shuffled, TODAY)?.tripId ?? null).toBe(expected);
        if (card !== null) {
          expect(DURATION_TEXT.test(JSON.stringify(card))).toBe(false);
        }

        const inRange = list.filter(
          (x) => x.trip.startDate <= TODAY && TODAY <= x.trip.endDate
        );
        const live = inRange.filter((x) => x.itinerary === 'CONFIRMED');
        if (expected !== null) hits.card += 1;
        if (live.length > 0 && inRange.some((x) => x.itinerary === 'unknown')) {
          hits.blockedByUnknown += 1;
        }
        if (expected !== null) {
          const w = list.find((x) => x.trip.tripId === expected)!.trip;
          const twins = live.filter(
            (x) =>
              x.trip.startDate === w.startDate && x.trip.endDate === w.endDate
          );
          if (twins.length > 1) hits.tieById += 1;
          const outsideUnknown = list.some(
            (x) =>
              x.itinerary === 'unknown' &&
              !(x.trip.startDate <= TODAY && TODAY <= x.trip.endDate)
          );
          if (outsideUnknown) hits.outsideUnknownCard += 1;
        }
      }),
      { numRuns: 400 }
    );

    expect(hits.card).toBeGreaterThan(0);
    expect(hits.blockedByUnknown).toBeGreaterThan(0);
    expect(hits.tieById).toBeGreaterThan(0);
    expect(hits.outsideUnknownCard).toBeGreaterThan(0);
  });
});

// ── AC-6 legend `›` 집합 ───────────────────────────────────────────────────

describe('🔴 AC-6 · openableTripIds — 누르면 실제로 이동하는 여행과 같은 집합', () => {
  it('종료(ENDED)·시작 ≤ 오늘인 여행만 담고 미래 여행은 뺀다', () => {
    const trips = [
      trip('t-past', '2026-06-01', '2026-06-03', { status: 'ENDED' }),
      trip('t-now', '2026-06-10', '2026-06-12', { status: 'ACTIVE' }),
      trip('t-today', '2026-06-11', '2026-06-13'),
      trip('t-fut', '2026-06-20', '2026-06-22'),
      // 서버가 종료로 준 여행은 날짜가 미래여도 열린다(canOpenTripRecords 규칙 그대로).
      trip('t-ended-early', '2026-06-20', '2026-06-22', { status: 'ENDED' }),
    ];

    const ids = openableTripIds(trips, TODAY);

    expect([...ids].sort()).toEqual([
      't-ended-early',
      't-now',
      't-past',
      't-today',
    ]);
  });

  it('목록이 null 이면 빈 집합, null 원소는 건너뛴다', () => {
    expect(openableTripIds(null, TODAY).size).toBe(0);
    expect(openableTripIds(undefined, TODAY).size).toBe(0);
    expect([
      ...openableTripIds(
        [null, trip('t-now', '2026-06-10', '2026-06-12')],
        TODAY
      ),
    ]).toEqual(['t-now']);
  });

  it('PBT — 어떤 여행이든 집합 포함 여부 = canOpenTripRecords(오라클 = 페이지 이동 판정)', () => {
    const tripArb = fc
      .record({
        n: fc.integer({ min: 0, max: 9 }),
        s: fc.constantFrom(
          '2026-06-01',
          '2026-06-10',
          '2026-06-11',
          '2026-06-12',
          '2026-07-01'
        ),
        status: fc.constantFrom('PLANNED', 'ACTIVE', 'ENDED'),
      })
      .map(({ n, s, status }) =>
        trip(`t${n}`, s, '2026-07-31', { status: status as Trip['status'] })
      );

    fc.assert(
      fc.property(
        fc.uniqueArray(tripArb, { selector: (t) => t.tripId, maxLength: 8 }),
        (trips) => {
          const ids = openableTripIds(trips, TODAY);
          for (const t of trips) {
            expect(ids.has(t.tripId)).toBe(canOpenTripRecords(t, TODAY));
          }
          expect(ids.size).toBe(
            trips.filter((t) => canOpenTripRecords(t, TODAY)).length
          );
        }
      ),
      { numRuns: 200 }
    );
  });
});
