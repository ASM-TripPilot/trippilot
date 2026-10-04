import fc from 'fast-check';

import type { TripDestination } from '@/shared/api/index.schemas';

import { regionForDay } from './regionForDay';

/**
 * TRIP-1043 · QA #041 — 같이 짜기 진행 줄 앞에 붙일 "그날 여행지"(결정 3).
 * TRIP-1233 — 장소 추가(h13) 후보 지역도 이 규칙을 쓰므로 `pages/itinerary/itinerary-copick/model` 에서
 * `entities/trip` 공개 API 로 내렸다(사본 금지 — 규칙 한 벌). 케이스는 옮기기만 했다.
 *
 * 무엇을 보장하나: 여행지를 **seq 순서로 박수(nights)만큼** 펼쳐 N일차의 지역을 고른다. 박수 합을
 * 넘는 날(귀국일 포함)은 seq 가 가장 큰 여행지다(TRIP-1010 D7 의 밤 단위 규칙을 날 단위로). 여행지가
 * 없으면 null — 화면은 접두를 생략한다(INV-4 정직 degrade). 입력 배열의 순서는 결과에 영향이 없고,
 * 입력을 변형하지 않는다.
 *
 * 3동작: 준비(여행지 목록·일차) → 실행(regionForDay) → 단언(지역 이름 또는 null).
 */

const SHUFFLED: TripDestination[] = [
  { seq: 2, region: '경주', nights: 1 },
  { seq: 1, region: '부산', nights: 2 },
];

describe('🔴 D · 예시표 — seq 순서로 박수 누적, 넘치면 마지막 seq', () => {
  it.each([
    [1, '부산'],
    [2, '부산'],
    [3, '경주'],
    [4, '경주'],
  ])('D1 · %i일차 → %s (배열 순서가 아니라 seq 순서)', (day, region) => {
    expect(regionForDay(SHUFFLED, day)).toBe(region);
  });

  it('D2 · 박수 합을 한참 넘는 날도 seq 가 가장 큰 여행지다', () => {
    expect(regionForDay(SHUFFLED, 10)).toBe('경주');
  });

  it('D3 · 여행지가 없으면 null 이다(접두 생략)', () => {
    expect(regionForDay([], 1)).toBeNull();
    expect(regionForDay([], 3)).toBeNull();
  });

  it('D4 · 1박 한 곳이면 귀국일(2일차)도 그 여행지다', () => {
    const single: TripDestination[] = [{ seq: 1, region: '강진군', nights: 1 }];
    expect(regionForDay(single, 1)).toBe('강진군');
    expect(regionForDay(single, 2)).toBe('강진군');
  });
});

/**
 * 속성 테스트용 입력 — seq 는 서로 다르고(같은 seq 끼리의 순서는 정본이 정하지 않았다) 지역 이름은
 * `R{seq}` 로 유일하다(결과 문자열로 "몇 번째 여행지인가"를 되읽기 위해, 02a ★8).
 */
const destinationsArb = fc
  .uniqueArray(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 5 })
  .chain((seqs) =>
    fc
      .array(fc.integer({ min: 0, max: 4 }), {
        minLength: seqs.length,
        maxLength: seqs.length,
      })
      .map((nightsList) =>
        seqs.map((seq, index): TripDestination => ({
          seq,
          region: `R${seq}`,
          nights: nightsList[index],
        }))
      )
  );

const totalNights = (destinations: TripDestination[]): number =>
  destinations.reduce((sum, destination) => sum + destination.nights, 0);

const lastSeqRegion = (destinations: TripDestination[]): string =>
  `R${Math.max(...destinations.map((destination) => destination.seq))}`;

describe('🔴 P · 속성 — 어떤 여행지 목록에도 성립', () => {
  it('P1 · 결과는 언제나 입력 여행지 중 하나다', () => {
    fc.assert(
      fc.property(
        destinationsArb,
        fc.integer({ min: 1, max: 30 }),
        (destinations, day) => {
          const regions = destinations.map((destination) => destination.region);
          expect(regions).toContain(regionForDay(destinations, day));
        }
      )
    );
  });

  it('P2 · 배열 순서를 섞어도 결과가 같다', () => {
    fc.assert(
      fc.property(
        destinationsArb.chain((destinations) =>
          fc.tuple(
            fc.constant(destinations),
            fc.shuffledSubarray(destinations, {
              minLength: destinations.length,
              maxLength: destinations.length,
            })
          )
        ),
        fc.integer({ min: 1, max: 30 }),
        ([destinations, shuffled], day) => {
          expect(regionForDay(shuffled, day)).toBe(
            regionForDay(destinations, day)
          );
        }
      )
    );
  });

  it('P3 · 박수 합을 넘는 날은 seq 가 가장 큰 여행지다', () => {
    fc.assert(
      fc.property(
        destinationsArb,
        fc.integer({ min: 1, max: 5 }),
        (destinations, extra) => {
          const day = totalNights(destinations) + extra;
          expect(regionForDay(destinations, day)).toBe(
            lastSeqRegion(destinations)
          );
        }
      )
    );
  });

  it('P4 · 박수 안의 날들은 여행지마다 정확히 nights 일씩, seq 가 되돌아가지 않게 배정된다', () => {
    fc.assert(
      fc.property(
        destinationsArb.filter((destinations) => totalNights(destinations) > 0),
        (destinations) => {
          const total = totalNights(destinations);
          const picked = Array.from({ length: total }, (_, index) =>
            regionForDay(destinations, index + 1)
          );

          // ① 개수 — 각 여행지가 받은 날 수 = 그 여행지의 박수.
          destinations.forEach(({ region, nights }) => {
            expect(picked.filter((name) => name === region).length).toBe(
              nights
            );
          });

          // ② 순서 — 날이 갈수록 seq 가 줄지 않는다(앞 여행지로 되돌아가지 않음).
          const seqs = picked.map((name) => Number(String(name).slice(1)));
          seqs.slice(1).forEach((seq, index) => {
            expect(seq).toBeGreaterThanOrEqual(seqs[index]);
          });
        }
      )
    );
  });

  it('P5 · 입력 배열을 바꾸지 않는다(정렬은 사본)', () => {
    fc.assert(
      fc.property(
        destinationsArb,
        fc.integer({ min: 1, max: 30 }),
        (destinations, day) => {
          const before = destinations.map((destination) => ({
            ...destination,
          }));
          regionForDay(destinations, day);
          expect(destinations).toEqual(before);
        }
      )
    );
  });
});
