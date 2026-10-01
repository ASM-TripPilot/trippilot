import fc from 'fast-check';

import type { ItineraryStatus, Trip } from '@/shared/api/generated/schemas';

import type { DoneBarEntry } from './doneBar';
import { byLatest, orderMyTrips } from './myTripsOrder';

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
