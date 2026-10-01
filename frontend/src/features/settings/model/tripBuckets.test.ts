import fc from 'fast-check';

import type { TripPhase } from '@/entities/trip/lib/tripPhase';
import type { Trip, TripStatus } from '@/shared/api/generated/schemas';

import * as tripBucketsModule from './tripBuckets';
import { bucketTrips, phaseBucket, type TripBucket } from './tripBuckets';

/**
 * TRIP-1123 · US-NOTIF-07 · BR-U6-22(개정) — 마이페이지 숫자 3칸의 집계 순수 함수.
 *
 * 단계 판정(`classifyTripPhase` — 일정 확정 × 서울 오늘)은 1121 것을 그대로 쓰고, 이 파일은 그 결과를
 * **칸으로 옮기는 일**과 **모름이면 숫자를 내지 않는 일**만 맡는다.
 *
 * 무엇을 보장하나:
 *  - `phaseBucket`: draft → 칸 없음(null), upcoming → 예정, ongoing → 진행 중, ended → 종료.
 *  - `bucketTrips`: ① 빠지는 여행·두 번 세는 여행이 없다 ② 칸마다 입력 순서가 그대로다 ③ 반환은 입력 객체
 *    그대로다 ④ 초안은 어느 칸에도 없다 ⑤ '모름'이 하나라도 있으면 null(숫자를 안 낸다, INV-4)
 *    ⑥ 생성기가 초안·모름·각 단계를 실제로 만든다(문제로그 2026-08-02 "PBT 생성기 공백").
 *  - 서버 `Trip.status`(날짜만 봐서 초안도 ACTIVE)를 보지 않는다 — 생성기가 status 를 단계와 따로 뽑으므로,
 *    status 로 칸을 고르는 구현은 ② 에서 red 가 된다. 옛 `tripStatusBucket` 은 export 에서 사라진다.
 *
 * 커버하지 않는 것: 날짜 판정 자체(`tripPhase.test.ts` 몫), 칸 안 정렬(지난 여행 종료일 내림차순은 페이지 몫).
 *
 * *(개념 — PBT)* fast-check 가 무작위 입력을 수백 개 만들고, "어떤 입력이 와도 참"인 성질을 매번 확인한다.
 */

type Phase = TripPhase | 'unknown';

/** 단계 → 칸 정본 표 — 구현과 따로 적은 **리터럴 사본**(오라클은 다른 길로, 1121 02a ★8). */
const EXPECTED_BUCKET: Record<TripPhase, TripBucket | null> = {
  draft: null,
  upcoming: 'upcoming',
  ongoing: 'active',
  ended: 'ended',
};

const KNOWN_PHASES: TripPhase[] = ['draft', 'upcoming', 'ongoing', 'ended'];
const STATUSES: TripStatus[] = ['PLANNED', 'CONFIRMED', 'ACTIVE', 'ENDED'];

const knownPhaseArb = fc.constantFrom<TripPhase>(...KNOWN_PHASES);
const statusArb = fc.constantFrom<TripStatus>(...STATUSES);
/** 한 여행 = (단계, 서버 status) — 둘을 **따로** 뽑는다. status 가 판정에 새면 오배치로 드러난다. */
const knownEntryArb = fc.record({ phase: knownPhaseArb, status: statusArb });
const anyEntryArb = fc.record({
  phase: fc.constantFrom<Phase>(...KNOWN_PHASES, 'unknown'),
  status: statusArb,
});

function makeTrip(tripId: string, status: TripStatus): Trip {
  return {
    tripId,
    title: '여행',
    startDate: '2026-06-10',
    endDate: '2026-06-12',
    party: 1,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

/** (단계, status) 목록 → 입력 entries. tripId 를 위치로 유일하게 매겨 순서·정체성을 추적한다. */
function toEntries(
  rows: readonly { phase: Phase; status: TripStatus }[]
): { trip: Trip; phase: Phase }[] {
  return rows.map((row, i) => ({
    trip: makeTrip(`t${i}`, row.status),
    phase: row.phase,
  }));
}

const BUCKETS: TripBucket[] = ['upcoming', 'active', 'ended'];

describe('phaseBucket — 단계 → 칸 (전수 4값)', () => {
  it('draft 는 칸이 없고(null), 나머지 셋은 표대로 한 칸이다', () => {
    KNOWN_PHASES.forEach((phase) => {
      // 실행 → 단언: 리터럴 표와 완전 일치.
      expect(phaseBucket(phase)).toBe(EXPECTED_BUCKET[phase]);
    });
  });
});

describe('bucketTrips — 예제 (경계·앵커)', () => {
  it('빈 입력이면 세 칸이 모두 빈 배열이다(모름 아님 → null 아님)', () => {
    expect(bucketTrips([])).toEqual({ upcoming: [], active: [], ended: [] });
  });

  it('QA 재현 — 기간 안 여행 4건 중 확정 1 · 초안 3 이면 진행 중은 1건이다(4 아님)', () => {
    // 준비: 서버 status 는 넷 다 ACTIVE(날짜 파생) — 옛 사영이면 4가 된다.
    const entries = toEntries([
      { phase: 'ongoing', status: 'ACTIVE' },
      { phase: 'draft', status: 'ACTIVE' },
      { phase: 'draft', status: 'ACTIVE' },
      { phase: 'draft', status: 'ACTIVE' },
    ]);

    // 실행
    const buckets = bucketTrips(entries);

    // 단언
    expect(buckets).not.toBeNull();
    expect(buckets?.active.map((t) => t.tripId)).toEqual(['t0']);
    expect(buckets?.upcoming).toEqual([]);
    expect(buckets?.ended).toEqual([]);
  });

  it.each([
    ['맨 앞', ['unknown', 'ongoing', 'ended']],
    ['가운데', ['upcoming', 'unknown', 'ended']],
    ['맨 끝', ['upcoming', 'ongoing', 'unknown']],
    ['초안 옆', ['draft', 'unknown']],
    ['혼자', ['unknown']],
  ] as const)('모름이 %s 에 하나만 있어도 null 이다', (_where, phases) => {
    const entries = toEntries(
      phases.map((phase) => ({ phase, status: 'PLANNED' as TripStatus }))
    );

    expect(bucketTrips(entries)).toBeNull();
  });

  it('초안만 있으면 세 칸이 모두 비어 있다(null 아님)', () => {
    const entries = toEntries([
      { phase: 'draft', status: 'ENDED' },
      { phase: 'draft', status: 'ACTIVE' },
    ]);

    expect(bucketTrips(entries)).toEqual({
      upcoming: [],
      active: [],
      ended: [],
    });
  });

  it('옛 서버 status 사영(tripStatusBucket)은 더 이상 내보내지 않는다', () => {
    // 남아 있으면 누군가 다시 status 로 세어 초안이 되살아난다(01b 3-a).
    expect(Object.keys(tripBucketsModule)).not.toContain('tripStatusBucket');
    // 짝 앵커 — 모듈은 실제로 읽혔다(빈 객체라 공짜 통과하는 것을 막는다).
    expect(Object.keys(tripBucketsModule)).toContain('bucketTrips');
  });
});

describe('bucketTrips — PBT (모름 없음)', () => {
  it('① 유실·중복 없음 + ② 칸별 순서 보존 + ④ 초안 제외 + ⑥ 생성기 적중', () => {
    // ⑥ 생성기 점검 — 실행 중 각 단계가 실제로 나왔는지 센다.
    const seen: Record<TripPhase, number> = {
      draft: 0,
      upcoming: 0,
      ongoing: 0,
      ended: 0,
    };
    let mixedRuns = 0; // 초안과 초안 아닌 것이 한 입력에 섞인 실행 수

    fc.assert(
      fc.property(fc.array(knownEntryArb, { maxLength: 12 }), (rows) => {
        // 준비
        const entries = toEntries(rows);
        rows.forEach((row) => {
          seen[row.phase] += 1;
        });
        if (
          rows.some((r) => r.phase === 'draft') &&
          rows.some((r) => r.phase !== 'draft')
        ) {
          mixedRuns += 1;
        }

        // 실행
        const buckets = bucketTrips(entries);

        // 단언 — 모름이 없으면 null 이 아니다.
        expect(buckets).not.toBeNull();
        if (buckets === null) return;

        // ① 세 칸 길이 합 = 초안 아닌 입력 수.
        const nonDraft = rows.filter((r) => r.phase !== 'draft').length;
        expect(
          buckets.upcoming.length + buckets.active.length + buckets.ended.length
        ).toBe(nonDraft);

        // ② 칸마다 tripId 배열 = 입력을 리터럴 표로 거른 배열(순서까지).
        BUCKETS.forEach((bucket) => {
          const expected = entries
            .filter((e) => EXPECTED_BUCKET[e.phase as TripPhase] === bucket)
            .map((e) => e.trip.tripId);
          expect(buckets[bucket].map((t) => t.tripId)).toEqual(expected);
        });

        // ④ 초안은 어느 칸에도 없고, 초안 아닌 여행은 정확히 한 칸에 한 번.
        const all = [...buckets.upcoming, ...buckets.active, ...buckets.ended];
        entries.forEach((e) => {
          const hits = all.filter((t) => t.tripId === e.trip.tripId).length;
          expect(hits).toBe(e.phase === 'draft' ? 0 : 1);
        });
      }),
      { numRuns: 200 }
    );

    // ⑥ 단언 — 생성기가 네 단계를 모두, 그리고 섞인 입력을 실제로 만들었다.
    KNOWN_PHASES.forEach((phase) => {
      expect(seen[phase]).toBeGreaterThan(0);
    });
    expect(mixedRuns).toBeGreaterThan(0);
  });

  it('③ 반환 trip 은 입력 객체 그대로다(새 객체를 지어내지 않는다)', () => {
    fc.assert(
      fc.property(fc.array(knownEntryArb, { maxLength: 12 }), (rows) => {
        const entries = toEntries(rows);
        const inputs = entries.map((e) => e.trip);

        const buckets = bucketTrips(entries);
        expect(buckets).not.toBeNull();
        if (buckets === null) return;

        [...buckets.upcoming, ...buckets.active, ...buckets.ended].forEach(
          (t) => {
            expect(inputs).toContain(t);
          }
        );
      })
    );
  });
});

describe('bucketTrips — PBT (모름 차단, INV-4)', () => {
  it('⑤ 입력 어디에든 모름이 하나라도 있으면 null 이다 + ⑥ 모름 위치 적중', () => {
    const at = { start: 0, middle: 0, end: 0 };

    fc.assert(
      fc.property(
        fc.array(anyEntryArb, { maxLength: 6 }),
        statusArb,
        fc.array(anyEntryArb, { maxLength: 6 }),
        (before, status, after) => {
          // 준비 — 모름 하나를 앞·뒤 무작위 목록 사이에 끼운다(앞뒤에도 모름이 더 있을 수 있다).
          const rows = [
            ...before,
            { phase: 'unknown' as Phase, status },
            ...after,
          ];
          if (before.length === 0) at.start += 1;
          else if (after.length === 0) at.end += 1;
          else at.middle += 1;

          // 실행 → 단언
          expect(bucketTrips(toEntries(rows))).toBeNull();
        }
      ),
      { numRuns: 200 }
    );

    // ⑥ — 모름이 맨 앞·가운데·맨 끝에 놓이는 경우를 생성기가 실제로 만들었다.
    expect(at.start).toBeGreaterThan(0);
    expect(at.middle).toBeGreaterThan(0);
    expect(at.end).toBeGreaterThan(0);
  });

  it('⑤ 짝 — 모름이 없으면 null 이 아니다(늘 null 을 내는 구현을 막는다)', () => {
    fc.assert(
      fc.property(fc.array(knownEntryArb, { maxLength: 8 }), (rows) => {
        expect(bucketTrips(toEntries(rows))).not.toBeNull();
      })
    );
  });
});
