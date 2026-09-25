import fc from 'fast-check';

import type {
  ItineraryGenerationState,
  ItineraryStatus,
  Trip,
} from '@/shared/api/generated/schemas';

import { pickDoneBar, type DoneBarEntry } from './doneBar';
import { deriveTripCardFace } from './tripCardFace';

/**
 * TRIP-928 · 완료 도킹 배너 대상 고르기(순수). 여행 목록 + 여행별 일정 두 축 + seen(이미 배너로 알린
 * 여행 id) → 띄울 여행 1건과 저장할 seen, 또는 null.
 *
 * - 완성 = 카드 배지와 같은 판정(`deriveTripCardFace(...).badge==='done'`, 01b Q1).
 * - 하나라도 일정이 아직 안 왔으면 보류(null) — 덜 최근 완성이 배너를 선점하지 않게(AC-7).
 * - 후보 중 정렬 키(`updatedAt ?? createdAt`)가 가장 최근인 1건(AC-2).
 * - seenNext = (seen ∩ 목록 id) ∪ 지금 완성 전부(01b Q2·Q5).
 */

function trip(tripId: string, updatedAt: string): Trip {
  return {
    tripId,
    title: `${tripId} 여행`,
    startDate: '2099-06-10',
    endDate: '2099-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt,
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

const DONE = { status: 'CONFIRMED', generationState: 'COMPLETE' } as const;
const DRAFT = { status: 'PLANNED', generationState: 'COMPLETE' } as const;

function entry(
  t: Trip,
  itinerary: DoneBarEntry['itinerary'] = DONE
): DoneBarEntry {
  return { trip: t, itinerary };
}

describe('🔴 pickDoneBar · 대상 고르기', () => {
  it('seen 에 없는 완성 여행이 하나면 그 여행을 고른다', () => {
    const pick = pickDoneBar(
      [entry(trip('trip-a', '2026-08-10T00:00:00.000Z'))],
      []
    );

    expect(pick?.target.tripId).toBe('trip-a');
  });

  it('완성이 여럿이면 정렬 키가 가장 최근인 완성을 고른다 (목록 첫째·입력 첫째가 아니어도)', () => {
    // 준비 — C(초안)가 전체 최신이라 정렬상 첫째, A(옛 완성)가 입력 첫째. 정답은 B.
    const entries = [
      entry(trip('trip-a', '2026-08-10T00:00:00.000Z')),
      entry(trip('trip-c', '2026-08-30T00:00:00.000Z'), DRAFT),
      entry(trip('trip-b', '2026-08-20T00:00:00.000Z')),
    ];

    expect(pickDoneBar(entries, [])?.target.tripId).toBe('trip-b');
  });

  it('updatedAt 이 없으면 createdAt 으로 비교한다', () => {
    const noUpdated = {
      ...trip('trip-new', ''),
      createdAt: '2026-09-01T00:00:00.000Z',
    } as Partial<Trip>;
    delete noUpdated.updatedAt;

    const pick = pickDoneBar(
      [
        entry(trip('trip-old', '2026-08-10T00:00:00.000Z')),
        entry(noUpdated as Trip),
      ],
      []
    );

    expect(pick?.target.tripId).toBe('trip-new');
  });

  it('가장 최근 완성이 이미 seen 이면 그다음 완성을 고른다', () => {
    const entries = [
      entry(trip('trip-a', '2026-08-10T00:00:00.000Z')),
      entry(trip('trip-b', '2026-08-20T00:00:00.000Z')),
    ];

    expect(pickDoneBar(entries, ['trip-b'])?.target.tripId).toBe('trip-a');
  });

  it('완성이 전부 seen 이면 null', () => {
    const entries = [
      entry(trip('trip-a', '2026-08-10T00:00:00.000Z')),
      entry(trip('trip-b', '2026-08-20T00:00:00.000Z')),
    ];

    expect(pickDoneBar(entries, ['trip-a', 'trip-b'])).toBeNull();
  });

  it.each([
    [
      '생성중(PARTIAL+PLANNED)',
      { status: 'PLANNED', generationState: 'PARTIAL' },
    ],
    [
      '생성중(PARTIAL+CONFIRMED)',
      { status: 'CONFIRMED', generationState: 'PARTIAL' },
    ],
    [
      '초안(COMPLETE+PLANNED)',
      { status: 'PLANNED', generationState: 'COMPLETE' },
    ],
    ['초안(FAILED+PLANNED)', { status: 'PLANNED', generationState: 'FAILED' }],
    ['404(두 축 없음)', {}],
  ] as const)('완성이 아닌 여행만 있으면 null — %s', (_label, itinerary) => {
    const pick = pickDoneBar(
      [entry(trip('trip-a', '2026-08-10T00:00:00.000Z'), itinerary)],
      []
    );

    expect(pick).toBeNull();
  });

  it('일정이 하나라도 아직 안 왔으면 완성이 있어도 null (판정 보류)', () => {
    const entries = [
      entry(trip('trip-a', '2026-08-10T00:00:00.000Z')),
      entry(trip('trip-b', '2026-08-20T00:00:00.000Z'), 'pending'),
    ];

    expect(pickDoneBar(entries, [])).toBeNull();
  });

  it('빈 목록이면 null', () => {
    expect(pickDoneBar([], [])).toBeNull();
  });
});

describe('🔴 pickDoneBar · 저장할 seen (01b Q2·Q5)', () => {
  it('지금 완성인 여행 전부 + 목록에 남은 옛 seen 만 남기고, 목록 밖 id 는 버린다', () => {
    // 준비 — trip-gone 은 목록에 없음(정리 대상), trip-c 는 목록 안 초안(옛 seen 유지).
    const entries = [
      entry(trip('trip-a', '2026-08-10T00:00:00.000Z')),
      entry(trip('trip-b', '2026-08-20T00:00:00.000Z')),
      entry(trip('trip-c', '2026-08-30T00:00:00.000Z'), DRAFT),
    ];

    const pick = pickDoneBar(entries, ['trip-gone', 'trip-c']);

    expect(pick?.target.tripId).toBe('trip-b');
    expect([...(pick?.seenNext ?? [])].sort()).toEqual([
      'trip-a',
      'trip-b',
      'trip-c',
    ]);
  });
});

// ── PBT(AC-11) ─────────────────────────────────────────────────────────

const statusArb = fc.constantFrom<ItineraryStatus | undefined>(
  'PLANNED',
  'CONFIRMED',
  undefined
);
const generationArb = fc.constantFrom<ItineraryGenerationState | undefined>(
  'PARTIAL',
  'COMPLETE',
  'FAILED',
  undefined
);
const isoArb = fc
  .integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 11, 31) })
  .map((ms) => new Date(ms).toISOString());

const entriesArb = fc
  .uniqueArray(fc.constantFrom('t1', 't2', 't3', 't4', 't5', 't6'), {
    maxLength: 6,
  })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((id) =>
        fc.record({
          trip: isoArb.map((iso) => trip(id, iso)),
          itinerary: fc.oneof(
            { weight: 1, arbitrary: fc.constant('pending' as const) },
            {
              weight: 6,
              arbitrary: fc.record({
                status: statusArb,
                generationState: generationArb,
              }),
            }
          ),
        })
      )
    )
  )
  .map((list) => list as DoneBarEntry[]);

const seenArb: fc.Arbitrary<string[]> = fc.uniqueArray(
  fc.constantFrom('t1', 't2', 't3', 't4', 't5', 't6', 'gone-1', 'gone-2'),
  { maxLength: 8 }
);

function isDone(e: DoneBarEntry): boolean {
  return (
    e.itinerary !== 'pending' &&
    deriveTripCardFace(e.itinerary.status, e.itinerary.generationState)
      .badge === 'done'
  );
}

function key(t: Trip): string {
  return t.updatedAt ?? t.createdAt;
}

describe('🔴 pickDoneBar · 성질(PBT, AC-11)', () => {
  it('고른 여행은 완성 · seen 밖 · 후보 중 최신이고, seenNext 는 (seen∩목록)∪완성 전부다', () => {
    fc.assert(
      fc.property(entriesArb, seenArb, (entries, seen) => {
        const pick = pickDoneBar(entries, seen);
        const hasPending = entries.some((e) => e.itinerary === 'pending');
        const candidates = entries.filter(
          (e) => isDone(e) && !seen.includes(e.trip.tripId)
        );

        if (hasPending || candidates.length === 0) {
          expect(pick).toBeNull();
          return;
        }

        expect(pick).not.toBeNull();
        const target = pick!.target;
        const targetEntry = entries.find(
          (e) => e.trip.tripId === target.tripId
        )!;
        expect(isDone(targetEntry)).toBe(true);
        expect(seen).not.toContain(target.tripId);
        candidates.forEach((c) => {
          expect(key(target) >= key(c.trip)).toBe(true);
        });

        const listIds = entries.map((e) => e.trip.tripId);
        const expected = new Set([
          ...seen.filter((id) => listIds.includes(id)),
          ...entries.filter(isDone).map((e) => e.trip.tripId),
        ]);
        expect(new Set(pick!.seenNext)).toEqual(expected);
        expect(pick!.seenNext).toHaveLength(expected.size); // 중복 없음
      })
    );
  });
});
