import fc from 'fast-check';

import { NO_ITINERARY } from '@/test-support/tripItineraryCols';

import type { Trip } from '@/shared/api/index.schemas';

import type { DoneBarEntry } from './doneBar';
import { parseMyTripsSegment, splitMyTripsBySegment } from './myTripsSegment';

/**
 * TRIP-1785 · 내 여행 목록 「예정 / 지난」 세그 — 순수 모듈 `myTripsSegment`.
 *
 * 규칙(01b D1): 지난 = `classifyTripPhase` 가 `ended`(일정 확정 ∧ 오늘 > 종료일) 인 여행뿐. 작성중(draft)·시작 전·여행 중·
 * 일정 상태가 아직 안 온(pending) 여행은 전부 예정이다 — 날짜가 지났어도 확정 전이면 예정에 남는다.
 *
 * 무엇을 보장하나:
 *  - 분할은 둘로 나눌 뿐 잃거나 겹치지 않는다(합집합 = 입력, 교집합 = ∅) · 입력 순서와 객체를 그대로 둔다(정렬은 페이지가 `orderMyTrips` 로).
 *  - 경계: 종료일 당일은 여행 중(예정), 하루 지나면 지난.
 *  - 저장값 해석은 정확히 'past' 일 때만 지난 — 모르는 값·null·undefined 는 예정(INV-4).
 *
 * *(개념 — fast-check `examples`)* 속성 테스트의 무작위 입력에 더해 **반드시 한 번 돌릴 입력**을 박는 옵션. 경계(종료일 당일/다음 날)가
 *   무작위로 안 걸려도 항상 검사된다.
 */

const TODAY = '2026-11-05';

type Itin = DoneBarEntry['itinerary'];

function entry(
  tripId: string,
  endDate: string,
  itinerary: Itin,
  startDate = '2026-10-01'
): DoneBarEntry {
  const trip: Trip = {
    tripId,
    title: tripId,
    startDate,
    endDate,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 1 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...NO_ITINERARY,
  };
  return { trip, itinerary };
}

const CONFIRMED: Itin = { status: 'CONFIRMED', generationState: 'COMPLETE' };
const PLANNED: Itin = { status: 'PLANNED', generationState: 'COMPLETE' };

const ids = (list: readonly DoneBarEntry[]): string[] =>
  list.map((e) => e.trip.tripId);

describe('splitMyTripsBySegment — 예시', () => {
  it('끝난 확정 여행만 지난, 나머지(작성중·시작 전·여행 중·pending·일정 없음)는 전부 예정 — 입력 순서 그대로', () => {
    // 준비 — 날짜가 지났어도 확정 전이면 예정(작성중), 일정 상태 미도착(pending)도 예정.
    const entries = [
      entry('ended', '2026-11-04', CONFIRMED),
      entry('draft-past', '2026-11-04', PLANNED),
      entry('no-itinerary-past', '2026-11-04', {}),
      entry('pending-past', '2026-11-04', 'pending'),
      entry('upcoming', '2099-01-02', CONFIRMED, '2099-01-01'),
      entry('ongoing', '2099-12-31', CONFIRMED, '2020-01-01'),
      entry('ended-2', '2026-06-13', CONFIRMED, '2026-06-10'),
    ];

    // 실행
    const { upcoming, past } = splitMyTripsBySegment(entries, TODAY);

    // 단언 — 지난 둘, 예정 다섯, 각자 입력 순서. 분할을 빼먹으면(전부 예정) past 가 비어 red.
    expect(ids(past)).toEqual(['ended', 'ended-2']);
    expect(ids(upcoming)).toEqual([
      'draft-past',
      'no-itinerary-past',
      'pending-past',
      'upcoming',
      'ongoing',
    ]);
  });

  it('경계: 종료일 당일은 예정(여행 중) · 하루 지나면 지난', () => {
    const entries = [
      entry('last-day', TODAY, CONFIRMED),
      entry('yesterday', '2026-11-04', CONFIRMED),
    ];

    const { upcoming, past } = splitMyTripsBySegment(entries, TODAY);

    expect(ids(upcoming)).toEqual(['last-day']);
    expect(ids(past)).toEqual(['yesterday']);
  });

  it('같은 입력, 오늘만 하루 넘기면 어제까지 예정이던 여행이 지난으로 간다 (자정 넘김)', () => {
    const entries = [entry('x', '2026-11-05', CONFIRMED)];

    expect(ids(splitMyTripsBySegment(entries, '2026-11-05').past)).toEqual([]);
    expect(ids(splitMyTripsBySegment(entries, '2026-11-06').past)).toEqual([
      'x',
    ]);
  });

  it('입력 엔트리 객체를 그대로(동일 참조) 돌려주고 입력 배열은 건드리지 않는다', () => {
    const a = entry('a', '2026-11-04', CONFIRMED);
    const b = entry('b', '2099-01-02', CONFIRMED);
    const input = Object.freeze([a, b]);

    const { upcoming, past } = splitMyTripsBySegment(input, TODAY);

    expect(past[0]).toBe(a);
    expect(upcoming[0]).toBe(b);
    expect(input).toEqual([a, b]);
  });

  it('빈 입력이면 둘 다 빈 배열', () => {
    expect(splitMyTripsBySegment([], TODAY)).toEqual({
      upcoming: [],
      past: [],
    });
  });
});

describe('splitMyTripsBySegment — 속성', () => {
  const itinArb: fc.Arbitrary<Itin> = fc.constantFrom<Itin>(
    'pending',
    {},
    PLANNED,
    CONFIRMED
  );
  const endArb = fc.constantFrom('2026-11-04', '2026-11-05', '2026-11-06');
  const entriesArb = fc
    .array(fc.tuple(endArb, itinArb), { maxLength: 12 })
    .map((rows) =>
      rows.map(([end, itin], index) => entry(`t${index}`, end, itin))
    );

  it('합집합 = 입력(잃지 않음) · 교집합 = ∅(겹치지 않음) · 지난 ⟺ 확정 ∧ 종료일 < 오늘 — 각 묶음은 입력 순서를 지킨다', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const { upcoming, past } = splitMyTripsBySegment(entries, TODAY);

        // 오라클 — 구현과 다른 경로: 일정 객체에 CONFIRMED 가 있고 종료일 문자열이 오늘보다 작으면 지난.
        const expectedPast = entries.filter(
          (e) =>
            e.itinerary !== 'pending' &&
            e.itinerary.status === 'CONFIRMED' &&
            e.trip.endDate < TODAY
        );
        const expectedUpcoming = entries.filter(
          (e) => !expectedPast.includes(e)
        );

        expect(ids(past)).toEqual(ids(expectedPast));
        expect(ids(upcoming)).toEqual(ids(expectedUpcoming));
        // 합집합·교집합을 따로 한 번 더(오라클이 같이 틀려도 개수 보존은 걸린다).
        expect(upcoming.length + past.length).toBe(entries.length);
        expect(ids(upcoming).filter((id) => ids(past).includes(id))).toEqual(
          []
        );
      }),
      {
        examples: [
          // 경계가 무작위에서 빠져도 항상 도는 입력 — 종료일 하루 전 확정(지난)·당일 확정(예정)·확정 전 과거(예정).
          [
            [
              entry('e1', '2026-11-04', CONFIRMED),
              entry('e2', '2026-11-05', CONFIRMED),
              entry('e3', '2026-11-04', PLANNED),
            ],
          ],
        ],
      }
    );
  });
});

describe('parseMyTripsSegment — 기기에서 읽은 값 해석 (INV-4)', () => {
  it.each([
    ['past', 'past'],
    ['upcoming', 'upcoming'],
  ])('저장값 %s → %s', (raw, expected) => {
    expect(parseMyTripsSegment(raw)).toBe(expected);
  });

  it.each([
    ['모르는 문자열', 'foo'],
    ['대문자', 'PAST'],
    ['빈 문자열', ''],
    ['프로토타입 키', 'toString'],
    ['null(저장 없음)', null],
    ['undefined', undefined],
    ['숫자', 42],
    ['객체', { past: true }],
  ])('%s 이면 예정으로 접는다', (_label, raw) => {
    expect(parseMyTripsSegment(raw)).toBe('upcoming');
  });
});
