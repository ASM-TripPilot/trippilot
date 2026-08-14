import fc from 'fast-check';

import type { Trip } from '@/shared/api/generated/schemas';

import { formatDday, resolveHomePhase } from './homePhase';

/**
 * TRIP-371 (01b) — 홈 실데이터 배선의 순수 판정 두 함수.
 *
 * 무엇을 보장하나:
 *  - `formatDday(startDate, today)` 가 미래/당일/과거를 각각 `D-n`/`D-DAY`/`D+n` 로 가른다.
 *  - `resolveHomePhase(...)` 가 (1) 가장 이른 startDate 의 **비-ENDED** 여행을 지배로 골라
 *    planning 얼굴을 조립하고, (2) 여행이 없거나 전부 ENDED 면 `undefined`(→ 라우트가 phase
 *    미전달로 discovery)를 낸다. 이게 "로딩·오류·전ENDED 를 '여행 없음'으로 뭉개지 않는다"의
 *    순수-함수 절반이다(라우트 절반은 `tabsHomeRoute.test.tsx`).
 *
 * 개념 몇 가지(코드 초심자용):
 *  - **AAA**: 각 it 은 준비(입력 만들기)→실행(함수 호출)→단언(결과 확인) 3동작이다.
 *  - **PBT(속성 기반 테스트)**: 예제를 손으로 나열하는 대신 "어떤 입력에도 성립해야 하는
 *    성질"을 적으면 fast-check 가 임의 입력 수백 개로 반례를 찾는다(CI 차단 게이트).
 *  - **의존성 주입(formatTripMeta)**: `resolveHomePhase` 는 meta 문자열을 스스로 만들지 않고
 *    "만드는 함수"를 인자로 받는다. `features/home` 은 경계상 `features/trip`·`features/itinerary`
 *    의 포맷터를 import 할 수 없어서다(라우트가 진짜 포맷터를 넣고, 테스트는 가짜를 넣는다).
 *  - **구조적 대입**: 아래 `trip()` 이 만드는 실 `Trip` 객체가 `resolveHomePhase` 의
 *    `HomeTripInput`(5필드) 인자에 그대로 들어간다 — Trip 이 5필드를 전부 가져 컴파일이 통과하며,
 *    라우트가 `useGetTrips().data`(Trip[])를 그대로 넘길 수 있음을 이 컴파일이 증명한다.
 */

// ── 날짜 헬퍼(테스트 오라클 전용, UTC) ──────────────────────────────────────────
// planState.utcDayTime 과 같은 UTC 산술이라 CI 타임존에서도 하루가 안 밀린다.
const MS_PER_DAY = 86_400_000;
/** UTC epoch day → 'YYYY-MM-DD'. */
function toDateString(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

// ── 여행 팩토리 ────────────────────────────────────────────────────────────────
function trip(overrides: Partial<Trip>): Trip {
  return {
    tripId: '00000000-0000-0000-0000-000000000000',
    title: '여행',
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** planning 얼굴 조립에 필요한 meta 포맷터 — 단위 테스트는 title 을 되비추는 가짜를 쓴다. */
const metaOfTitle = (t: { title: string }) => `META:${t.title}`;

describe('formatDday — 미래/당일/과거 (01b)', () => {
  const CASES: { start: string; today: string; expected: string }[] = [
    { start: '2026-06-22', today: '2026-06-01', expected: 'D-21' },
    { start: '2026-06-04', today: '2026-06-01', expected: 'D-3' },
    { start: '2026-06-01', today: '2026-06-01', expected: 'D-DAY' },
    { start: '2026-05-29', today: '2026-06-01', expected: 'D+3' },
    // 달 경계 — 6월은 30일. 문자열 파싱이 아니라 UTC 일수 차라야 맞는다.
    { start: '2026-07-01', today: '2026-06-01', expected: 'D-30' },
    // 해 경계.
    { start: '2026-01-01', today: '2025-12-31', expected: 'D-1' },
  ];

  it.each(CASES)(
    '($start, $today) → $expected',
    ({ start, today, expected }) => {
      // 준비·실행·단언 — 입력은 인자, 실행은 호출, 단언은 완전일치(toBe).
      expect(formatDday(start, today)).toBe(expected);
    }
  );
});

describe('formatDday — 성질(PBT)', () => {
  it('오늘에서 d일 떨어진 날은 부호에 따라 D-d / D-DAY / D+|d| 이다', () => {
    fc.assert(
      fc.property(
        // 준비 — 기준일(2020~2030 근방 epoch)과 오프셋 d(-365~365)를 임의로 뽑는다.
        fc.integer({ min: 18262, max: 22280 }), // 2020-01-01 ~ 2030-12-31 근방 epoch day
        fc.integer({ min: -365, max: 365 }),
        (todayEpoch, d) => {
          const today = toDateString(todayEpoch);
          const start = toDateString(todayEpoch + d);

          // 실행.
          const label = formatDday(start, today);

          // 단언 — 부호가 얼굴을 정한다.
          const expected = d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : `D+${-d}`;
          expect(label).toBe(expected);
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('resolveHomePhase — discovery 갈래(여행 없음/전ENDED)', () => {
  it('빈 목록이면 undefined(라우트가 phase 미전달 → discovery)', () => {
    expect(
      resolveHomePhase({
        trips: [],
        today: '2026-06-01',
        savedCount: 0,
        formatTripMeta: metaOfTitle,
      })
    ).toBeUndefined();
  });

  it('여행이 전부 ENDED 면 undefined(종료 여행을 얼굴로 승격하지 않는다)', () => {
    expect(
      resolveHomePhase({
        trips: [
          trip({ status: 'ENDED', startDate: '2026-01-01' }),
          trip({ status: 'ENDED', startDate: '2026-02-01' }),
        ],
        today: '2026-06-01',
        savedCount: 0,
        formatTripMeta: metaOfTitle,
      })
    ).toBeUndefined();
  });
});

describe('resolveHomePhase — 지배 여행 선택(가장 이른 비-ENDED)', () => {
  it('더 이른 ENDED 가 있어도 비-ENDED 중 가장 이른 여행을 고른다', () => {
    // 준비 — ENDED(1월)가 가장 이르지만 제외, 비-ENDED 중 PLANNED(7월)가 CONFIRMED(9월)보다 이르다.
    const result = resolveHomePhase({
      trips: [
        trip({ status: 'ENDED', startDate: '2026-01-01', title: '지난 여행' }),
        trip({
          status: 'CONFIRMED',
          startDate: '2026-09-01',
          title: '가을 여행',
        }),
        trip({
          status: 'PLANNED',
          startDate: '2026-07-01',
          title: '여름 여행',
        }),
      ],
      today: '2026-06-01',
      savedCount: 0,
      formatTripMeta: metaOfTitle,
    });

    // 단언 — 지배는 '여름 여행'(가장 이른 비-ENDED).
    expect(result?.kind).toBe('planning');
    if (result?.kind === 'planning') {
      expect(result.trip.title).toBe('여름 여행');
    }
  });
});

describe('resolveHomePhase — 상태별 badge(01b Q2)', () => {
  it('ACTIVE 여행은 badge 가 "여행 중"이다', () => {
    const result = resolveHomePhase({
      trips: [trip({ status: 'ACTIVE', startDate: '2026-06-05' })],
      today: '2026-06-01',
      savedCount: 0,
      formatTripMeta: metaOfTitle,
    });
    expect(result?.kind === 'planning' && result.trip.badge).toBe('여행 중');
  });

  it('PLANNED 여행은 badge 가 "계획 중"이다', () => {
    const result = resolveHomePhase({
      trips: [trip({ status: 'PLANNED', startDate: '2026-06-22' })],
      today: '2026-06-01',
      savedCount: 0,
      formatTripMeta: metaOfTitle,
    });
    expect(result?.kind === 'planning' && result.trip.badge).toBe('계획 중');
  });
});

describe('resolveHomePhase — title·dday·meta 전달', () => {
  it('title 은 여행값, dday 는 formatDday 위임, meta 는 주입 포맷터를 통과한다', () => {
    // 준비 — 단일 PLANNED, today 대비 21일 뒤.
    const result = resolveHomePhase({
      trips: [
        trip({
          status: 'PLANNED',
          startDate: '2026-06-22',
          title: '제주 여행',
        }),
      ],
      today: '2026-06-01',
      savedCount: 3,
      formatTripMeta: metaOfTitle,
    });

    // 단언 — 세 값이 각자 출처에서 온다(픽스처 상수 아님).
    expect(result?.kind).toBe('planning');
    if (result?.kind === 'planning') {
      expect(result.trip.title).toBe('제주 여행');
      expect(result.trip.dday).toBe('D-21'); // formatDday('2026-06-22','2026-06-01')
      expect(result.trip.meta).toBe('META:제주 여행'); // 주입 포맷터 통과
      // greetTitle 은 여행명 + D-day 를 **함께** 담는다 — 둘 중 하나를 빼면 red(03b 경고-1
      // 봉합: 이 인사말은 planning 실착지에서 실데이터로 그려지는데 지금까지 무판정이었다).
      expect(result.greetTitle).toBe('제주 여행 D-21');
    }
  });

  it('🔴 bridge 는 서버 담은 곳 **실카운트**를 반영한다 — 상수로 굳히면 red (03b 경고-1)', () => {
    // 왜 savedCount=7 인가: 구현이 개수를 상수(예 fixture 의 3)로 굳혀도 3곳 케이스만으론
    // 안 잡힌다. 7 곳으로 주면 어떤 상수 N(≠7)도 '7곳'을 못 맞춰 red — 담은 곳 5개인
    // 실사용자에게 "담은 곳 3곳"이 뜨는 거짓 개수(실데이터 위장, 이 티켓의 금지 AC)를 막는다.
    const result = resolveHomePhase({
      trips: [trip({ status: 'PLANNED', startDate: '2026-06-22' })],
      today: '2026-06-01',
      savedCount: 7,
      formatTripMeta: metaOfTitle,
    });

    expect(result?.kind).toBe('planning');
    if (result?.kind === 'planning') {
      expect(result.bridge.title).toContain('7곳');
    }
  });
});

describe('resolveHomePhase — 성질(PBT)', () => {
  // 임의 여행 하나 — status 4종 + 2020~2030 근방 유효 startDate.
  const tripArb = fc.record({
    status: fc.constantFrom('PLANNED', 'CONFIRMED', 'ACTIVE', 'ENDED'),
    startEpoch: fc.integer({ min: 18262, max: 22280 }),
    title: fc.string(),
  });

  it('비-ENDED 가 없으면 undefined, 있으면 가장 이른 비-ENDED startDate 를 고른다', () => {
    fc.assert(
      fc.property(fc.array(tripArb, { maxLength: 6 }), (raw) => {
        const trips = raw.map((r) =>
          trip({
            status: r.status,
            startDate: toDateString(r.startEpoch),
            title: r.title,
          })
        );
        // meta 에 startDate 를 되비추는 가짜 포맷터 — 결과가 어느 startDate 를 골랐는지 드러낸다.
        const result = resolveHomePhase({
          trips,
          today: '2026-06-01',
          savedCount: 0,
          formatTripMeta: (t) => t.startDate,
        });

        const nonEndedStarts = trips
          .filter((t) => t.status !== 'ENDED')
          .map((t) => t.startDate);

        if (nonEndedStarts.length === 0) {
          // (A) 비-ENDED 0개 → undefined(여행 없음으로 뭉개지 않는 것의 반대 짝).
          expect(result).toBeUndefined();
        } else {
          // (B) 비-ENDED ≥1 → planning, 고른 startDate 는 최소(문자열 사전순 = 연대순, tie 무관).
          const minStart = [...nonEndedStarts].sort()[0];
          expect(result?.kind).toBe('planning');
          if (result?.kind === 'planning') {
            expect(result.trip.meta).toBe(minStart);
            expect(['여행 중', '계획 중']).toContain(result.trip.badge);
          }
        }
      }),
      { numRuns: 500 }
    );
  });

  it('비-ENDED 가 하나라도 있으면 실제로 planning 이 나온다(가짜 통과 방지 짝)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('PLANNED', 'CONFIRMED', 'ACTIVE'),
        fc.integer({ min: 18262, max: 22280 }),
        (status, startEpoch) => {
          const result = resolveHomePhase({
            trips: [trip({ status, startDate: toDateString(startEpoch) })],
            today: '2026-06-01',
            savedCount: 0,
            formatTripMeta: metaOfTitle,
          });
          expect(result?.kind).toBe('planning');
        }
      ),
      { numRuns: 300 }
    );
  });
});
