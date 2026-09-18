import fc from 'fast-check';

import type { Trip } from '@/shared/api/generated/schemas';
import { TripStatus } from '@/shared/api/generated/schemas';

import { bucketTrips, tripStatusBucket, type TripBucket } from './tripBuckets';

/**
 * TRIP-604 · US-NOTIF-07 · BR-U6-22 — tripBuckets: Trip.status 4값을 3분류로 접는 순수 함수.
 *
 * 무엇을 보장하나: `tripStatusBucket`은 임의의 status를 세 버킷 중 정확히 하나로 사영하고
 * (PLANNED·CONFIRMED→upcoming · ACTIVE→active · ENDED→ended), `bucketTrips`는 목록을 세
 * 버킷으로 나누되 **유실도 중복도 오배치도 없이**, 각 버킷 안에서 입력 순서를 보존한다. 화면·서버
 * 없이 값만 검사한다(순수 함수). 정렬(임박순/최근순)은 컨테이너 몫이라 여기서 검사하지 않는다.
 *
 * 커버하지 않는 것:
 *  - 버킷 간·버킷 내 정렬 기준(Q4 — 시작일/종료일 정렬은 `TripCardContainer`/`MyPage` 배선 몫).
 *  - status 4값 밖의 문자열 — 계약(TripStatus enum)이 닫힌 집합을 보장하므로 방어 코드·생성기 없음.
 *
 * PBT 근거: `baseSections.test.ts`(fast-check@^4) 동형. `fc.constantFrom(...리터럴)`은
 * `Arbitrary<유니온>`이라 TripStatus로 그대로 쓰인다(02a §5-E).
 */

/** status→버킷 정본 매핑표. 아래 모든 단언이 이 표를 진실로 삼는다. */
const EXPECTED: Record<TripStatus, TripBucket> = {
  PLANNED: 'upcoming',
  CONFIRMED: 'upcoming',
  ACTIVE: 'active',
  ENDED: 'ended',
};

const BUCKETS: TripBucket[] = ['upcoming', 'active', 'ended'];

/** 임의의 유효 status 생성기 — 리터럴 유니온이라 `Arbitrary<TripStatus>`. */
const statusArb = fc.constantFrom(
  TripStatus.PLANNED,
  TripStatus.CONFIRMED,
  TripStatus.ACTIVE,
  TripStatus.ENDED
);

/** 최소 Trip — bucketTrips는 status만 보지만 타입은 Trip[]이라 나머지 필드를 채운다. */
function makeTrip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 'trip-x',
    title: '여행',
    startDate: '2026-06-10',
    endDate: '2026-06-12',
    party: 1,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

describe('AC-2 · tripStatusBucket — 단건 사영 (전수 4값)', () => {
  it('네 status를 매핑표대로 접고, 결과는 언제나 세 버킷 중 하나다', () => {
    (Object.keys(EXPECTED) as TripStatus[]).forEach((status) => {
      // Arrange/Act — 단건 호출.
      const bucket = tripStatusBucket(status);

      // Assert — 완전일치 매핑 + 세 버킷 폐집합 안.
      expect(bucket).toBe(EXPECTED[status]);
      expect(BUCKETS).toContain(bucket);
    });
  });
});

describe('AC-2 · tripStatusBucket — PBT: 임의 status → 정확히 한 버킷', () => {
  it('어떤 status가 와도 유효 버킷 하나를 매핑표대로 반환한다', () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const bucket = tripStatusBucket(status);
        expect(BUCKETS).toContain(bucket);
        expect(bucket).toBe(EXPECTED[status]);
      })
    );
  });
});

describe('AC-2 · bucketTrips — PBT: 분할(유실0·중복0·오배치0·순서보존)', () => {
  it('세 버킷 길이합이 입력 길이이고, 각 버킷의 tripId 배열이 입력 필터와 순서까지 같다', () => {
    fc.assert(
      fc.property(fc.array(statusArb), (statuses) => {
        // Arrange — tripId를 유일하게 부여해 순서·정체성을 추적한다.
        const trips = statuses.map((status, i) =>
          makeTrip({ tripId: `t${i}`, status })
        );

        // Act — 1회 호출.
        const buckets = bucketTrips(trips);

        // Assert ① 유실·중복 없음 — 길이합 === 입력 길이.
        expect(
          buckets.upcoming.length + buckets.active.length + buckets.ended.length
        ).toBe(trips.length);

        // Assert ② membership + order + no-loss + no-dup 동시 — 버킷별 tripId 배열이
        // 입력을 predicate로 거른 배열과 순서까지 완전히 같다(★11).
        const idsWhere = (pred: (s: TripStatus) => boolean): string[] =>
          trips.filter((t) => pred(t.status)).map((t) => t.tripId);

        expect(buckets.upcoming.map((t) => t.tripId)).toEqual(
          idsWhere((s) => s === 'PLANNED' || s === 'CONFIRMED')
        );
        expect(buckets.active.map((t) => t.tripId)).toEqual(
          idsWhere((s) => s === 'ACTIVE')
        );
        expect(buckets.ended.map((t) => t.tripId)).toEqual(
          idsWhere((s) => s === 'ENDED')
        );
      })
    );
  });

  it('반환 trip은 입력 객체 그대로다 — 새 객체를 지어내지 않는다(참조 동일)', () => {
    fc.assert(
      fc.property(fc.array(statusArb), (statuses) => {
        const trips = statuses.map((status, i) =>
          makeTrip({ tripId: `t${i}`, status })
        );

        const buckets = bucketTrips(trips);
        const out = [...buckets.upcoming, ...buckets.active, ...buckets.ended];

        // 반환된 모든 trip이 입력 배열에 === 로 존재한다(복제·날조 0).
        out.forEach((t) => {
          expect(trips).toContain(t);
        });
      })
    );
  });
});
