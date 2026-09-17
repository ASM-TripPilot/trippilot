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

// ── TRIP-472 · badge 는 날짜로만 판정한다(dday 와 같은 소스라 모순 조합이 안 나온다) ──────────
// 이전(01b Q2)엔 badge 가 server status(ACTIVE?)를, dday 가 today 를 봤다 — 두 소스가 달라
// "여행 중" + "D-1" 모순이 노출됐다. 이제 오늘이 [startDate, endDate] 안이면 '여행 중', 아니면
// '계획 중'. status 는 badge 를 좌우하지 않는다(→ ctaLabel 로 옮겨감, 아래 describe).
describe('resolveHomePhase — badge 는 날짜 기반(TRIP-472)', () => {
  it('오늘이 [startDate, endDate] 안이면 badge 가 "여행 중" (status 무관 — PLANNED 여도)', () => {
    const result = resolveHomePhase({
      // start 05-29 ≤ today 06-01 ≤ end 06-13(팩토리 기본). status 는 일부러 PLANNED.
      trips: [trip({ status: 'PLANNED', startDate: '2026-05-29' })],
      today: '2026-06-01',
      savedCount: 0,
      formatTripMeta: metaOfTitle,
    });
    expect(result?.kind === 'planning' && result.trip.badge).toBe('여행 중');
  });

  it('오늘이 시작 전이면 badge 는 "계획 중" — ACTIVE 여도(모순 제거의 핵심)', () => {
    // 서버가 아직 안 시작한 여행을 ACTIVE 로 줘도(status 앞섬), 날짜상 D-21 이면 '계획 중'.
    const result = resolveHomePhase({
      trips: [trip({ status: 'ACTIVE', startDate: '2026-06-22' })],
      today: '2026-06-01',
      savedCount: 0,
      formatTripMeta: metaOfTitle,
    });
    expect(result?.kind === 'planning' && result.trip.badge).toBe('계획 중');
    // badge 와 badgeSub 가 한 소스라 "여행 중" + "· D-n" 조합이 원천적으로 안 나온다.
    // TRIP-696: dday 는 배지 보조 badgeSub('· '+dday)로 흡수됐다.
    expect(result?.kind === 'planning' && result.trip.badgeSub).toBe('· D-21');
  });
});

describe('resolveHomePhase — badge×badgeSub 모순 없음(PBT, TRIP-472·696)', () => {
  it('badge 가 "여행 중"이면 badgeSub 는 절대 시작 전 "· D-<숫자>"가 아니다', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('PLANNED', 'CONFIRMED', 'ACTIVE'),
        fc.integer({ min: 18262, max: 22280 }), // startEpoch
        fc.integer({ min: 0, max: 20 }), // 여행 길이(박)
        fc.integer({ min: -30, max: 30 }), // today 오프셋(시작일 대비)
        (status, startEpoch, nights, offset) => {
          const start = toDateString(startEpoch);
          const end = toDateString(startEpoch + nights);
          const today = toDateString(startEpoch + offset);
          const result = resolveHomePhase({
            trips: [trip({ status, startDate: start, endDate: end })],
            today,
            savedCount: 0,
            formatTripMeta: metaOfTitle,
          });
          if (result?.kind !== 'planning') return;
          if (result.trip.badge === '여행 중') {
            // 시작 전('· D-<숫자>')인데 여행 중이면 모순 — 절대 없어야 한다.
            // '· D-DAY'(시작 당일)는 \d 가 아니라 매치 안 됨(여행 중과 정합이라 허용).
            // badgeSub='· '+dday. .test 는 undefined 를 'undefined'로 강제해 throw 없이
            // false 를 주므로, 구현 전(badgeSub 미정의)엔 vacuous green(부정 성질) — red-first
            // 아님. 구현 후 실값에 이빨(여행 중 + 미래 D- 뮤턴트 red).
            const isFutureDday = /^· D-\d/.test(result.trip.badgeSub ?? '');
            expect(isFutureDday).toBe(false);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('resolveHomePhase — ctaLabel 은 status 로 분기(TRIP-472)', () => {
  const CASES: { status: Trip['status']; expected: string }[] = [
    { status: 'PLANNED', expected: '일정 이어서 짜기' },
    { status: 'CONFIRMED', expected: '확정 일정 보기' },
    { status: 'ACTIVE', expected: '여행 일정 보기' },
  ];
  it.each(CASES)(
    '$status → ctaLabel "$expected"(하드코딩 「일정 이어서 짜기」 고정이면 red)',
    ({ status, expected }) => {
      const result = resolveHomePhase({
        trips: [trip({ status, startDate: '2026-06-22' })],
        today: '2026-06-01',
        savedCount: 0,
        formatTripMeta: metaOfTitle,
      });
      expect(result?.kind === 'planning' && result.trip.ctaLabel).toBe(
        expected
      );
    }
  );
});

describe('resolveHomePhase — title·badgeSub·greetSubtitle·collectionsTitle·meta 조립(TRIP-696)', () => {
  it('title 은 여행값, badgeSub 는 "· "+formatDday, meta 는 주입 포맷터, 서브카피·지역 컬렉션 헤더를 조립한다', () => {
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

    // 단언 — 값이 각자 출처에서 온다(픽스처 상수 아님).
    expect(result?.kind).toBe('planning');
    if (result?.kind === 'planning') {
      expect(result.trip.title).toBe('제주 여행');
      // TRIP-696 — dday 는 배지 보조 badgeSub('· '+dday)로. formatDday('2026-06-22','2026-06-01')='D-21'.
      expect(result.trip.badgeSub).toBe('· D-21');
      expect(result.trip.meta).toBe('META:제주 여행'); // 주입 포맷터 통과
      // greetTitle 은 여행명 + D-day 를 **함께** 담는다(무변경 — 계획 중은 `${title} ${dday}`).
      expect(result.greetTitle).toBe('제주 여행 D-21');
      // TRIP-696 인사 서브카피(고정) + 지역 컬렉션 헤더(title 후행 "여행" 제거 → 지역).
      expect(result.greetSubtitle).toBe('일정을 이어서 짜볼까요');
      expect(result.collectionsTitle).toBe('제주에서 담을 만한 곳');
    }
  });

  it('collectionsTitle 지역은 후행 "여행"만 떼고 조립한다(앞머리 "여행"은 보존 — /\\s*여행$/ 앵커)', () => {
    // 후행 "여행"이 없는 title(앞머리 '여행자')은 전체가 지역이 된다(task canon:
    // region = title.replace(/\s*여행$/,'')). naïve `.replace('여행','')` 는 앞머리를 떼서 red.
    const result = resolveHomePhase({
      trips: [
        trip({
          status: 'PLANNED',
          startDate: '2026-06-22',
          title: '여행자 모임',
        }),
      ],
      today: '2026-06-01',
      savedCount: 0,
      formatTripMeta: metaOfTitle,
    });
    expect(result?.kind === 'planning' && result.collectionsTitle).toBe(
      '여행자 모임에서 담을 만한 곳'
    );
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

// ── TRIP-697 · 여행 중 N일차(오늘−시작일+1, features/home/model 계산) ──────────────────────
// 오늘이 여행 기간 안이면(isTraveling) 배지 보조는 D-day 가 아니라 "· N 일차", 인사 타이틀은
// "${title} N일차예요", 그리고 2섹션 판별 showSpots=true 가 된다. N 계산은 features/home 경계
// 안에서 한다(entities/trip/lib 아님, homeStructure D-1). off-by-one 경계: 시작 당일 = 1일차.
//
// 무엇을 보장하나: (1) N 이 today−startDate+1 로 정확히 매겨진다(경계표), (2) 여행 상태와
// 배지 서식이 정합한다(여행 중 → 일차 꼴, 계획 중 → D 꼴 — PBT 로 모든 조합 검증),
// (3) showSpots 가 여행 중일 때만 켜진다(계획 중 부정 짝), (4) 라이브엔 이름 소스가 없어
// resolveHomePhase 는 greetName 을 채우지 않는다(픽스처 전용 계약 잠금, ★ 정본 공백 가드).
//
// ⚠️ 서식 차이 주의: badgeSub 는 "· N 일차"(N 앞·뒤 공백 O), greetTitle 은 "…N일차예요"
//    (N 뒤 공백 X). Figma 실측(브리프 §화면·IO)이라 실검증에서 실제 날짜로 1회 확인함.
describe('resolveHomePhase — 여행 중 N일차 경계 (TRIP-697)', () => {
  // 지배 여행 '부산 여행' 6/10~6/13(3박 4일). today 를 옮겨 N(일차)을 가른다.
  const CASES: { today: string; day: number }[] = [
    { today: '2026-06-10', day: 1 }, // 시작 당일 = 1일차(off-by-one 경계, start당일=1)
    { today: '2026-06-11', day: 2 }, // 여행 2일차
    { today: '2026-06-13', day: 4 }, // 마지막 날(end) = 4일차
  ];

  it.each(CASES)(
    'today=$today → badgeSub "· $day 일차"·greetTitle "부산 여행 $day일차예요"·showSpots true·badge 여행 중',
    ({ today, day }) => {
      // 준비 — 여행 기간 [6/10, 6/13] 안의 today. status 는 무관(badge 는 날짜 기반, TRIP-472).
      const result = resolveHomePhase({
        trips: [
          trip({
            status: 'PLANNED',
            startDate: '2026-06-10',
            endDate: '2026-06-13',
            title: '부산 여행',
          }),
        ],
        today,
        savedCount: 0,
        formatTripMeta: metaOfTitle,
      });

      // 단언 — 여행 상태·N일차 서식·2섹션 판별.
      expect(result?.kind).toBe('planning');
      if (result?.kind === 'planning') {
        expect(result.trip.badge).toBe('여행 중');
        // badgeSub 는 "· N 일차"(공백 O) — 현 구현은 여행 중에 "· D-DAY"/"· D+n"이라 red.
        expect(result.trip.badgeSub).toBe(`· ${day} 일차`);
        // greetTitle 은 "${title} N일차예요"(공백 X) — 현 구현은 "부산 여행 D-DAY"류라 red.
        expect(result.greetTitle).toBe(`부산 여행 ${day}일차예요`);
        // showSpots 는 여행 중일 때만 true(2섹션 판별) — 현 구현은 미설정(undefined)이라 red.
        expect(result.showSpots).toBe(true);
        // ★ 정본 공백 가드 — resolveHomePhase 는 라이브 이름 소스가 없어 greetName 을 안 채운다
        //    (하드코딩 '태현님,' 을 심으면 red). 현 구현은 미설정이라 선제 green(회귀 앵커).
        expect(result.greetName).toBeUndefined();
      }
    }
  );
});

describe('resolveHomePhase — 계획 중은 showSpots·greetTitle 무변경(TRIP-697 부정 짝, 선제 green)', () => {
  it('시작 전이면 showSpots 는 truthy 가 아니고 greetTitle 은 기존 "${title} ${dday}" 이다', () => {
    // 준비 — 시작 21일 전(계획 중). isTraveling=false 라 696 계약이 그대로여야 한다.
    const result = resolveHomePhase({
      trips: [
        trip({
          status: 'PLANNED',
          startDate: '2026-06-22',
          title: '부산 여행',
        }),
      ],
      today: '2026-06-01',
      savedCount: 0,
      formatTripMeta: metaOfTitle,
    });

    expect(result?.kind).toBe('planning');
    if (result?.kind === 'planning') {
      // 계획 중은 1섹션 — showSpots 를 여행 중 판별이 true 로 새게 하면 계획 중에도 스팟 섹션이
      // 뜬다. 이 부정 짝이 위 여행 중 긍정 짝과 함께 "showSpots 는 여행 중일 때만"을 잠근다(★).
      expect(result.showSpots ?? false).toBe(false);
      // greetTitle 은 696 그대로(여행 중 N일차 조립이 계획 중으로 새면 red).
      expect(result.greetTitle).toBe('부산 여행 D-21');
    }
  });
});

describe('resolveHomePhase — badgeSub 서식은 여행 상태와 정합(PBT, TRIP-697)', () => {
  it('여행 중이면 badgeSub 는 "· N 일차" 꼴, 계획 중이면 "· D-n"/"· D-DAY"/"· D+n" 꼴이다', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('PLANNED', 'CONFIRMED', 'ACTIVE'),
        fc.integer({ min: 18262, max: 22280 }), // startEpoch(2020~2030 근방)
        fc.integer({ min: 0, max: 20 }), // 여행 길이(박)
        fc.integer({ min: -30, max: 30 }), // today 오프셋(시작일 대비)
        (status, startEpoch, nights, offset) => {
          const start = toDateString(startEpoch);
          const end = toDateString(startEpoch + nights);
          const today = toDateString(startEpoch + offset);
          const result = resolveHomePhase({
            trips: [trip({ status, startDate: start, endDate: end })],
            today,
            savedCount: 0,
            formatTripMeta: metaOfTitle,
          });
          if (result?.kind !== 'planning') return;
          if (result.trip.badge === '여행 중') {
            // 여행 중 → "· N 일차"(N≥1). D 꼴이면 모순 — 현 구현(여행 중에도 "· D-DAY"/"· D+n")은 red.
            expect(result.trip.badgeSub).toMatch(/^· \d+ 일차$/);
          } else {
            // 계획 중(시작 전·종료 후) → D 꼴("· D-n"/"· D-DAY"/"· D+n"). 일차 꼴이면 안 된다(선제 green).
            expect(result.trip.badgeSub).toMatch(/^· D[-+]/);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});
