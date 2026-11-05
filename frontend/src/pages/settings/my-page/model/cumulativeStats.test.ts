import fc from 'fast-check';

import type {
  Trip,
  TripRecordList,
  TripRecordSummary,
} from '@/shared/api/index.schemas';
import { PAST, myPageTrip } from '@/test-support/myPageItineraries';

import { cumulativeStats } from './cumulativeStats';

/**
 * TRIP-1790 · 마이 탭 「지금까지」 — 누적 통계(여행·도시·방문) 순수 함수.
 *
 * 입력은 "종료 여행 목록"(마이 탭 「종료」 칸과 같은 판정으로 이미 거른 것)과 `GET /me/records` 응답이다.
 * 이 파일은 거르는 일(종료 판정)이 아니라 **세는 일**만 맡는다.
 *
 * 무엇을 보장하나:
 *  - 여행 = 종료 여행 수. 도시 = 목적지 `regionCode` 앞 2자리(시도)의 고유 수 — 이름이 같아도 시도가 다르면 따로(서울 강서구 ≠ 부산 강서구),
 *    같은 시도의 시군구는 하나. 코드가 없으면(null·키 없음·빈 문자열) `sidoKey(region)` 으로 접는다.
 *  - 방문 = 종료 여행의 tripId 로 records 를 조인한 `visitCount` 합 — records 가 종료가 아닌 여행(예정·작성중)의 방문을 함께 줘도 안 센다.
 *    조인 안 되는 종료 여행은 0.
 *  - 모름(`ended` null · records 미도착)이면 null — 0 이 아니다(INV-4). 방문 0 은 아는 값이라 숫자 0.
 *  - 잘림 표시: records 가 상한 100건을 채우면(`items.length >= 100`) `truncated`.
 *
 * 커버하지 않는 것: 종료 판정 자체(`tripBuckets`·`tripPhase` 몫), `–`·`+` 글자 표기(StatsCard 몫), 코드 있는 목적지와 이름 폴백 목적지가
 * 같은 시도일 때 합치는지(구현 재량 — 고정하지 않는다).
 *
 * 코드 모양은 서버 시드 `R__seed_region_catalog.sql` 에서 가져왔다: 시도 2자리(`11` 서울·`26` 부산·`50` 제주), 시군구 5자리
 * (`26350` 해운대구·`26440` 부산 강서구·`11500` 서울 강서구·`50110` 제주시).
 *
 * *(개념 — PBT)* fast-check 가 무작위 입력을 만들어 "어떤 입력이 와도 참"인 성질을 확인한다. 정답(오라클)은 구현과 다른 길 —
 *  아래 코드→시도 **리터럴 표** — 로 계산한다.
 */

type Dest = { region: string; regionCode?: string | null };

/** 종료 여행 한 건 — 목적지만 정한다(나머지는 공용 픽스처 기본값). */
function ended(tripId: string, dests: Dest[]): Trip {
  return myPageTrip(tripId, PAST, {
    destinations: dests.map((dest, i) => ({ seq: i + 1, nights: 1, ...dest })),
  });
}

function rec(tripId: string, visitCount: number): TripRecordSummary {
  return {
    tripId,
    title: `${tripId} 기록`,
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    regions: [],
    visitCount,
    photoCount: 0,
  };
}

function recordsOf(items: TripRecordSummary[]): TripRecordList {
  return { items };
}

/** 종료 여행과 무관한 필러 record n 건 — 방문 합에 안 섞이는 tripId. */
function filler(n: number): TripRecordSummary[] {
  return Array.from({ length: n }, (_, i) => rec(`filler-${i}`, 1));
}

const BUSAN = { region: '부산광역시', regionCode: '26' };
const HAEUNDAE = { region: '해운대구', regionCode: '26350' };
const JEJU_SI = { region: '제주시', regionCode: '50110' };

describe('예시 — AC-1 · 도시·방문 세기', () => {
  it('E1 · 종료 3건(부산·부산 시군구·제주) + 방문 4·5·3 → 여행 3 · 도시 2 · 방문 12 (종료 아닌 여행의 방문 7·모르는 여행 9 는 안 센다)', () => {
    // 준비 — records 에는 종료 3건 외에 예정 여행(visitCount 7)과 목록에 없는 여행(9)도 온다.
    const trips = [
      ended('t1', [BUSAN]),
      ended('t2', [HAEUNDAE]),
      ended('t3', [JEJU_SI]),
    ];
    const records = recordsOf([
      rec('t1', 4),
      rec('t2', 5),
      rec('t3', 3),
      rec('upcoming', 7),
      rec('stranger', 9),
    ]);

    // 실행
    const stats = cumulativeStats(trips, records);

    // 단언 — 합산 구현이면 방문 28, 부산 시군구를 별도로 세면 도시 3.
    expect(stats).toEqual({
      trips: 3,
      cities: 2,
      visits: 12,
      truncated: false,
    });
  });

  it('E2 · 이름이 같아도 시도가 다르면 따로 센다 — 서울 강서구(11500) · 부산 강서구(26440) → 2도시', () => {
    const stats = cumulativeStats(
      [
        ended('s', [{ region: '강서구', regionCode: '11500' }]),
        ended('b', [{ region: '강서구', regionCode: '26440' }]),
      ],
      recordsOf([])
    );

    expect(stats?.cities).toBe(2);
  });

  it('E3 · 같은 시도의 시군구 둘(해운대구 26350 · 강서구 26440) → 1도시', () => {
    const stats = cumulativeStats(
      [
        ended('a', [HAEUNDAE]),
        ended('b', [{ region: '강서구', regionCode: '26440' }]),
      ],
      recordsOf([])
    );

    expect(stats?.cities).toBe(1);
  });

  it('E4 · 한 여행의 목적지 둘(부산·제주시) → 2도시 · 다른 여행이 같은 시도를 또 가도 늘지 않는다', () => {
    const stats = cumulativeStats(
      [ended('a', [BUSAN, JEJU_SI]), ended('b', [HAEUNDAE, BUSAN])],
      recordsOf([])
    );

    expect(stats?.cities).toBe(2);
    expect(stats?.trips).toBe(2);
  });

  it("E5 · 코드가 없는 목적지(키 없음·null·'')는 이름을 시도로 접어 센다 — 부산광역시·부산 → 1도시, 서울특별시를 더하면 2", () => {
    // 준비 — 코드 없는 세 모양. 이름은 정식 명칭과 약칭이 섞여 온다.
    const oneCity = [
      ended('a', [{ region: '부산광역시' }]),
      ended('b', [{ region: '부산', regionCode: null }]),
      ended('c', [{ region: '부산', regionCode: '' }]),
    ];

    expect(cumulativeStats(oneCity, recordsOf([]))?.cities).toBe(1);
    expect(
      cumulativeStats(
        [...oneCity, ended('d', [{ region: '서울특별시' }])],
        recordsOf([])
      )?.cities
    ).toBe(2);
  });

  it('E6 · records 에 없는 종료 여행은 방문 0 으로 센다(여행 수에는 센다)', () => {
    const stats = cumulativeStats(
      [ended('t1', [BUSAN]), ended('t2', [BUSAN]), ended('t3', [JEJU_SI])],
      recordsOf([rec('t1', 4), rec('t2', 5)])
    );

    expect(stats).toMatchObject({ trips: 3, visits: 9 });
  });

  it('E7 · 방문 기록이 0건이어도 숫자 0 이다 — 모름(null)이 아니다', () => {
    const stats = cumulativeStats(
      [ended('t1', [BUSAN])],
      recordsOf([rec('t1', 0)])
    );

    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({ trips: 1, cities: 1, visits: 0 });
  });
});

describe('경계 — 모름·빈 목록·잘림', () => {
  it('E8 · 종료 목록을 모르거나(null) records 가 아직 없으면(undefined) null — 0 으로 접지 않는다', () => {
    const trips = [ended('t1', [BUSAN])];

    expect(cumulativeStats(null, recordsOf([rec('t1', 4)]))).toBeNull();
    expect(cumulativeStats(trips, undefined)).toBeNull();
    expect(cumulativeStats(null, undefined)).toBeNull();
    // 짝 — 둘 다 알면 객체다(항상 null 인 구현 방지).
    expect(cumulativeStats(trips, recordsOf([rec('t1', 4)]))).not.toBeNull();
  });

  it('E9 · 종료 여행 0건을 아는 상태면 세 값 0 이다(null 아님 — 카드를 숨길지는 화면 몫)', () => {
    const stats = cumulativeStats([], recordsOf([rec('x', 5)]));

    expect(stats).toMatchObject({ trips: 0, cities: 0, visits: 0 });
  });

  it('E10 · records 가 99건이면 안 잘린 것, 100건·101건이면 잘림', () => {
    const trips = [ended('t1', [BUSAN])];

    expect(cumulativeStats(trips, recordsOf(filler(99)))?.truncated).toBe(
      false
    );
    expect(cumulativeStats(trips, recordsOf(filler(100)))?.truncated).toBe(
      true
    );
    expect(cumulativeStats(trips, recordsOf(filler(101)))?.truncated).toBe(
      true
    );
  });
});

describe('성질 — 어떤 입력이 와도 (PBT)', () => {
  /** 실제 코드 풀과 그 시도 — 구현의 `slice(0, 2)` 가 아니라 **손으로 적은 표**가 정답이다. */
  const SIDO_OF: Record<string, string> = {
    '11': '서울',
    '11110': '서울',
    '11500': '서울',
    '26': '부산',
    '26350': '부산',
    '26440': '부산',
    '50': '제주',
    '50110': '제주',
    '50130': '제주',
    '41': '경기',
    '27': '대구',
  };
  const CODES = Object.keys(SIDO_OF);

  /** 종료 여행 스펙: 목적지 코드 1~3개 + 이 여행의 record 방문 수(없으면 record 없음). */
  const specArb = fc.record({
    codes: fc.array(fc.constantFrom(...CODES), {
      minLength: 1,
      maxLength: 3,
    }),
    visits: fc.option(fc.nat(60), { nil: undefined }),
  });
  const specsArb = fc.array(specArb, { minLength: 0, maxLength: 8 });
  const noiseArb = fc.array(fc.nat(60), { minLength: 0, maxLength: 5 });

  function build(
    specs: { codes: string[]; visits: number | undefined }[],
    noise: number[]
  ) {
    const trips = specs.map((spec, i) =>
      ended(
        `e${i}`,
        spec.codes.map((regionCode) => ({ region: '이름', regionCode }))
      )
    );
    const items = [
      ...specs.flatMap((spec, i) =>
        spec.visits === undefined ? [] : [rec(`e${i}`, spec.visits)]
      ),
      // 종료가 아닌 여행의 record — 방문 합에 들어오면 안 된다.
      ...noise.map((visits, j) => rec(`other${j}`, visits)),
    ];
    return { trips, records: recordsOf(items) };
  }

  it('P1~P3 · 여행 = 종료 여행 수 · 도시 = 목적지 시도의 고유 수 · 방문 = 종료 여행 record 의 합(없으면 0)', () => {
    fc.assert(
      fc.property(specsArb, noiseArb, (specs, noise) => {
        const { trips, records } = build(specs, noise);

        const stats = cumulativeStats(trips, records);

        const expectedCities = new Set(
          specs.flatMap((spec) => spec.codes.map((code) => SIDO_OF[code]))
        ).size;
        const expectedVisits = specs.reduce(
          (sum, spec) => sum + (spec.visits ?? 0),
          0
        );
        expect(stats).toMatchObject({
          trips: specs.length,
          cities: expectedCities,
          visits: expectedVisits,
        });
      })
    );
  });

  it('P4 · 종료 여행·record 의 순서를 뒤집어도 결과가 같다', () => {
    fc.assert(
      fc.property(specsArb, noiseArb, (specs, noise) => {
        const { trips, records } = build(specs, noise);

        const forward = cumulativeStats(trips, records);
        const backward = cumulativeStats(
          [...trips].reverse(),
          recordsOf([...records.items].reverse())
        );

        expect(backward).toEqual(forward);
      })
    );
  });

  it('P5 · truncated 는 records 가 100건 이상일 때, 그리고 그때만 참이다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 130 }), (count) => {
        const stats = cumulativeStats(
          [ended('t1', [BUSAN])],
          recordsOf(filler(count))
        );

        expect(stats?.truncated).toBe(count >= 100);
      })
    );
  });

  it('P6 · 코드가 없는 목적지만 있으면 도시 = 이름을 시도로 접은 고유 수다(코드 모양 3종 섞어서)', () => {
    // 접힘 표는 손으로 적은 정답 — 정식 명칭과 약칭이 같은 시도로 접힌다.
    const FOLDED: Record<string, string> = {
      서울특별시: '서울',
      서울: '서울',
      부산광역시: '부산',
      부산: '부산',
      제주특별자치도: '제주',
      제주: '제주',
    };
    const noCodeArb = fc.constantFrom<string | null | undefined>(
      null,
      undefined,
      ''
    );
    const destArb = fc.record({
      region: fc.constantFrom(...Object.keys(FOLDED)),
      code: noCodeArb,
    });

    fc.assert(
      fc.property(
        fc.array(fc.array(destArb, { minLength: 1, maxLength: 3 }), {
          minLength: 1,
          maxLength: 6,
        }),
        (tripDests) => {
          const trips = tripDests.map((dests, i) =>
            ended(
              `n${i}`,
              dests.map(({ region, code }) =>
                code === undefined ? { region } : { region, regionCode: code }
              )
            )
          );

          const stats = cumulativeStats(trips, recordsOf([]));

          const expected = new Set(
            tripDests.flatMap((dests) => dests.map((d) => FOLDED[d.region]))
          ).size;
          expect(stats?.cities).toBe(expected);
        }
      )
    );
  });
});
