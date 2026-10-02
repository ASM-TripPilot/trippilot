import fc from 'fast-check';

import type { Trip } from '@/shared/api/generated/schemas';
import { isDateInRange } from '@/shared/date';

import { canOpenTripRecords, recordsTripIdForDate } from './recordsCalendar';

/**
 * TRIP-1015 C · 기록 캘린더에서 "이 날짜(또는 이 여행)를 누르면 어느 여행 기록으로 가나"를 가르는 순수
 * 판정 (US-REC-14 · BR-U5-49 · 사용자 결정 2 · Seed Q3).
 *
 * 무엇을 보장하나:
 *  - 🔴 `canOpenTripRecords(trip, today)` — 진행 중(시작 ≤ 오늘)·지난(끝 < 오늘 또는 ENDED) 여행만 true.
 *    미래 여행(시작 > 오늘, ENDED 아님)은 false — 누르면 아무 데도 안 간다(결정 2).
 *  - 🔴 `recordsTripIdForDate(trips, date, today)` — 그 날짜를 포함하는 **열 수 있는** 여행 중 시작일이
 *    가장 늦은 것의 id. 없으면 null(마킹 없는 날·미래 여행만 걸린 날).
 *    한 날짜에 두 여행이 걸리면(A 가 9/28 에 끝나고 B 가 9/28 에 시작) 나중에 시작한 B(Q3).
 *
 * 왜 PBT 인가: 여행 수·겹침·오늘 위치 조합이 많아 예시 몇 개로는 "가장 늦은 시작"과 "미래 제외"가 함께
 * 맞는지 다 못 본다. 오라클은 구현과 다른 길(전수 필터 + 최댓값)로 계산한다.
 *
 * 3동작: 준비 = 여행 목록·오늘 → 실행 = 판정 함수 → 단언 = 고른 여행 id(또는 null).
 */

/** required 필드를 채운 최소 Trip — 판정이 보는 축(id·기간·상태)만 바꾼다. */
function trip(
  tripId: string,
  startDate: string | undefined,
  endDate: string | undefined,
  status: Trip['status'] = 'PLANNED'
): Trip {
  return {
    tripId,
    title: tripId,
    startDate,
    endDate,
    status,
    party: 2,
    destinations: [],
    preferenceSnapshot: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as unknown as Trip;
}

const TODAY = '2026-06-11';

describe('🔴 1015-C · canOpenTripRecords — 미래 여행만 막는다 (결정 2)', () => {
  it.each([
    ['진행 중(시작 < 오늘 < 끝)', true, trip('a', '2026-06-10', '2026-06-12')],
    ['오늘 시작', true, trip('a', '2026-06-11', '2026-06-13')],
    ['오늘 끝', true, trip('a', '2026-06-09', '2026-06-11')],
    [
      '지난 여행(끝 < 오늘, 상태 PLANNED)',
      true,
      trip('a', '2026-06-01', '2026-06-03'),
    ],
    ['지난 여행(ENDED)', true, trip('a', '2026-06-01', '2026-06-03', 'ENDED')],
    ['미래 여행(시작 > 오늘)', false, trip('a', '2026-06-20', '2026-06-22')],
    ['내일 시작', false, trip('a', '2026-06-12', '2026-06-14')],
    ['기간 미정(시작 없음)', false, trip('a', undefined, undefined)],
  ] as const)('%s → %s', (_label, expected, t) => {
    expect(canOpenTripRecords(t, TODAY)).toBe(expected);
  });
});

describe('🔴 1015-C · recordsTripIdForDate — 날짜 → 여행 (Q3)', () => {
  it('진행 중 여행의 기간 날짜를 누르면 그 여행이다', () => {
    const trips = [trip('now', '2026-06-10', '2026-06-12', 'ACTIVE')];
    expect(recordsTripIdForDate(trips, '2026-06-11', TODAY)).toBe('now');
    expect(recordsTripIdForDate(trips, '2026-06-10', TODAY)).toBe('now');
  });

  it('지난 여행의 기간 날짜도 그 여행이다', () => {
    const trips = [trip('past', '2026-06-01', '2026-06-03', 'ENDED')];
    expect(recordsTripIdForDate(trips, '2026-06-02', TODAY)).toBe('past');
  });

  it('미래 여행에만 걸린 날짜는 null 이다', () => {
    const trips = [trip('future', '2026-06-20', '2026-06-22')];
    expect(recordsTripIdForDate(trips, '2026-06-21', TODAY)).toBeNull();
  });

  it('어느 여행에도 안 걸린 날짜는 null 이다', () => {
    const trips = [trip('now', '2026-06-10', '2026-06-12', 'ACTIVE')];
    expect(recordsTripIdForDate(trips, '2026-06-15', TODAY)).toBeNull();
  });

  it('두 여행이 한 날짜에 걸리면 나중에 시작한 여행이다 — 목록 순서와 무관', () => {
    const a = trip('a', '2026-06-05', '2026-06-07', 'ENDED');
    const b = trip('b', '2026-06-07', '2026-06-08', 'ENDED');
    expect(recordsTripIdForDate([a, b], '2026-06-07', TODAY)).toBe('b');
    expect(recordsTripIdForDate([b, a], '2026-06-07', TODAY)).toBe('b');
  });

  it('겹친 날짜에서 한쪽이 미래 여행이면 열 수 있는 쪽이다', () => {
    const now = trip('now', '2026-06-09', '2026-06-11', 'ACTIVE');
    const future = trip('future', '2026-06-12', '2026-06-14');
    // 6/11 은 now 만 포함. 미래 여행이 시작 늦음을 이유로 끼어들지 않는다.
    expect(recordsTripIdForDate([now, future], '2026-06-11', TODAY)).toBe(
      'now'
    );
  });

  it('여행 목록이 비었거나 null 이어도 던지지 않고 null 이다', () => {
    expect(recordsTripIdForDate([], '2026-06-11', TODAY)).toBeNull();
    expect(recordsTripIdForDate(null, '2026-06-11', TODAY)).toBeNull();
  });
});

// ── PBT — 오라클(전수 필터 + 최대 시작일)과 같은 답인가 ─────────────────────────────
const JUNE_DAYS = Array.from(
  { length: 30 },
  (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`
);
const dayArb = fc.constantFrom(...JUNE_DAYS);
const statusArb = fc.constantFrom<Trip['status']>(
  'PLANNED',
  'CONFIRMED',
  'ACTIVE',
  'ENDED'
);
const tripArb = fc
  .tuple(dayArb, dayArb, statusArb)
  .map(([x, y, status]): [string, string, Trip['status']] =>
    x <= y ? [x, y, status] : [y, x, status]
  );
const tripsArb = fc
  .array(tripArb, { maxLength: 6 })
  .map((rows) =>
    rows.map(([start, end, status], i) => trip(`t${i}`, start, end, status))
  );

/** 오라클 — 판정 규칙을 글자 그대로 옮긴다(구현을 재사용하지 않는다). */
function openable(t: Trip, today: string): boolean {
  return t.status === 'ENDED' || (t.startDate != null && t.startDate <= today);
}

describe('🔴 1015-C · recordsTripIdForDate PBT', () => {
  it('결과는 null ⇔ 그 날짜를 포함하는 열 수 있는 여행이 없음 · 아니면 그중 시작이 가장 늦은 여행', () => {
    fc.assert(
      fc.property(tripsArb, dayArb, dayArb, (trips, date, today) => {
        const qualifying = trips.filter(
          (t) =>
            isDateInRange(date, t.startDate ?? null, t.endDate ?? null) &&
            openable(t, today)
        );
        const got = recordsTripIdForDate(trips, date, today);

        if (qualifying.length === 0) {
          expect(got).toBeNull();
          return;
        }
        const chosen = trips.find((t) => t.tripId === got);
        // 고른 여행이 자격을 갖췄고,
        expect(qualifying).toContain(chosen);
        // 그보다 늦게 시작한 자격 여행은 없다.
        const latest = qualifying
          .map((t) => t.startDate ?? '')
          .reduce((max, s) => (s > max ? s : max), '');
        expect(chosen?.startDate).toBe(latest);
      }),
      { numRuns: 300 }
    );
  });

  it('canOpenTripRecords 는 오라클과 같다', () => {
    fc.assert(
      fc.property(tripArb, dayArb, ([start, end, status], today) => {
        const t = trip('x', start, end, status);
        expect(canOpenTripRecords(t, today)).toBe(openable(t, today));
      }),
      { numRuns: 300 }
    );
  });
});
