import fc from 'fast-check';

import type { ItineraryStatus } from '@/entities/trip/model';

import { classifyTripPhase, isTripOngoing, type TripPhase } from './tripPhase';

/**
 * TRIP-1121 · AC-1·AC-2 — 여행 단계 분류 `classifyTripPhase(기간, 일정 상태, 오늘)`.
 *
 * "여행 중"은 서버 `Trip.status`(날짜만 봄 — 일정 없는 초안도 ACTIVE)가 아니라 **일정 확정 × 서울 날짜**로
 * 가른다(01b D1). 1123(l03 집계)·1120(j07 진행 중 카드)이 같은 함수를 가져다 쓴다(D2).
 *
 * 무엇을 보장하나:
 *  - 확정(CONFIRMED)이 아니면 날짜와 상관없이 'draft' — 기간 안 초안도 여행 중이 아니다.
 *  - 확정이면 오늘이 [시작일, 종료일] 안(양끝 포함)일 때만 'ongoing', 앞이면 'upcoming', 뒤면 'ended'.
 *  - 오늘은 인자로만 받는다 — 함수가 시계를 읽으면 아래 고정 날짜 표가 깨진다.
 *
 * *(개념 — PBT)* fast-check 가 무작위 입력을 수백 번 만들어 "구현 == 오라클"을 확인한다. 오라클은 날짜를
 *   정수(에포크 일수)로 비교해 구현(문자열 비교)과 **다른 길**로 답을 낸다 — 같은 길이면 같은 버그를 공유한다.
 */

const CONFIRMED: ItineraryStatus = 'CONFIRMED';
const PLANNED: ItineraryStatus = 'PLANNED';

type Row = [
  label: string,
  startDate: string,
  endDate: string,
  status: ItineraryStatus | undefined,
  today: string,
  expected: TripPhase,
];

const ROWS: Row[] = [
  [
    '확정 · 기간 안',
    '2026-09-29',
    '2026-09-30',
    CONFIRMED,
    '2026-09-29',
    'ongoing',
  ],
  [
    '확정 · 오늘 = 시작일',
    '2026-09-29',
    '2026-10-02',
    CONFIRMED,
    '2026-09-29',
    'ongoing',
  ],
  [
    '확정 · 오늘 = 종료일',
    '2026-09-25',
    '2026-09-29',
    CONFIRMED,
    '2026-09-29',
    'ongoing',
  ],
  [
    '확정 · 당일치기(시작=종료=오늘)',
    '2026-09-29',
    '2026-09-29',
    CONFIRMED,
    '2026-09-29',
    'ongoing',
  ],
  [
    '확정 · 내일 시작',
    '2026-09-30',
    '2026-10-02',
    CONFIRMED,
    '2026-09-29',
    'upcoming',
  ],
  [
    '확정 · 어제 끝남',
    '2026-09-20',
    '2026-09-28',
    CONFIRMED,
    '2026-09-29',
    'ended',
  ],
  [
    '확정 · 연말에 걸친 기간 안',
    '2026-12-31',
    '2027-01-02',
    CONFIRMED,
    '2026-12-31',
    'ongoing',
  ],
  [
    '확정 · 해가 바뀐 뒤 끝남',
    '2026-12-28',
    '2026-12-31',
    CONFIRMED,
    '2027-01-01',
    'ended',
  ],
  [
    '확정 · 달이 바뀐 뒤 끝남',
    '2026-09-28',
    '2026-09-30',
    CONFIRMED,
    '2026-10-01',
    'ended',
  ],
  [
    '초안(PLANNED) · 기간 안이어도',
    '2026-09-28',
    '2026-10-01',
    PLANNED,
    '2026-09-29',
    'draft',
  ],
  [
    '일정 없음(404) · 기간 안이어도',
    '2026-09-28',
    '2026-10-01',
    undefined,
    '2026-09-29',
    'draft',
  ],
  [
    '초안(PLANNED) · 미래',
    '2099-06-10',
    '2099-06-13',
    PLANNED,
    '2026-09-29',
    'draft',
  ],
  [
    '일정 없음(404) · 과거',
    '2026-06-10',
    '2026-06-13',
    undefined,
    '2026-09-29',
    'draft',
  ],
];

describe('🔴 C1 · classifyTripPhase — 확정 × 서울 날짜 (01b D1)', () => {
  it.each(ROWS)(
    '%s → %s~%s · %s · 오늘 %s',
    (_l, startDate, endDate, status, today, expected) => {
      // 준비 — 기간·일정 상태·오늘(문자열)
      // 실행
      const phase = classifyTripPhase({ startDate, endDate }, status, today);
      // 단언
      expect(phase).toBe(expected);
    }
  );
});

describe('🔴 C2 · isTripOngoing — ongoing 일 때만 true', () => {
  it.each(ROWS)('%s', (_l, startDate, endDate, status, today, expected) => {
    expect(isTripOngoing({ startDate, endDate }, status, today)).toBe(
      expected === 'ongoing'
    );
  });
});

// ── PBT ─────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** 에포크 일수 → 'YYYY-MM-DD'(UTC 달력 — 시계 아님, 고정 정수 환산). */
const isoOf = (day: number): string =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);

/** 오라클 — 매핑표 리터럴 사본을 **정수 비교**로(구현의 문자열 비교와 다른 길, 02a ★8). */
function oracle(
  start: number,
  end: number,
  status: ItineraryStatus | undefined,
  today: number
): TripPhase {
  if (status !== 'CONFIRMED') return 'draft';
  if (today < start) return 'upcoming';
  if (today > end) return 'ended';
  return 'ongoing';
}

/**
 * 생성기 — today 를 {시작일, 종료일, 시작일±20} 중에서 고른다(02a ★7). 무작위 날짜만 쓰면
 * 경계(오늘 = 시작일·종료일)가 거의 안 나온다(문제로그 2026-08-02 생성기 공백).
 */
const caseArb = fc.record({
  start: fc.integer({ min: 19_000, max: 25_000 }), // 2022-01 ~ 2038-06 — 월·연 경계를 자연히 넘는다
  length: fc.integer({ min: 0, max: 14 }),
  status: fc.constantFrom<ItineraryStatus | undefined>(
    'CONFIRMED',
    'PLANNED',
    undefined
  ),
  pick: fc.oneof(
    fc.constant<'start'>('start'),
    fc.constant<'end'>('end'),
    fc.integer({ min: -20, max: 20 })
  ),
});

describe('🔴 C3 · PBT — 구현 == 정수 오라클, 생성기가 경계·확정을 실제로 만든다', () => {
  it('임의 기간·상태·오늘에서 classifyTripPhase·isTripOngoing 이 오라클과 같다', () => {
    // 준비 — 적중 카운터(생성기 공백 감지)
    const hits = {
      ongoing: 0,
      upcoming: 0,
      ended: 0,
      draft: 0,
      confirmedTodayIsStart: 0,
      confirmedTodayIsEnd: 0,
    };

    // 실행
    fc.assert(
      fc.property(caseArb, ({ start, length, status, pick }) => {
        const end = start + length;
        const today =
          pick === 'start' ? start : pick === 'end' ? end : start + pick;
        const expected = oracle(start, end, status, today);

        hits[expected] += 1;
        if (status === 'CONFIRMED' && today === start)
          hits.confirmedTodayIsStart += 1;
        if (status === 'CONFIRMED' && today === end)
          hits.confirmedTodayIsEnd += 1;

        const period = { startDate: isoOf(start), endDate: isoOf(end) };
        expect(classifyTripPhase(period, status, isoOf(today))).toBe(expected);
        expect(isTripOngoing(period, status, isoOf(today))).toBe(
          expected === 'ongoing'
        );
      }),
      { numRuns: 500 }
    );

    // 단언 — 각 분기가 실제로 한 번 이상 생성됐다(생성기가 경계를 안 만들면 여기서 red).
    expect(hits.ongoing).toBeGreaterThan(0);
    expect(hits.upcoming).toBeGreaterThan(0);
    expect(hits.ended).toBeGreaterThan(0);
    expect(hits.draft).toBeGreaterThan(0);
    expect(hits.confirmedTodayIsStart).toBeGreaterThan(0);
    expect(hits.confirmedTodayIsEnd).toBeGreaterThan(0);
  });
});
