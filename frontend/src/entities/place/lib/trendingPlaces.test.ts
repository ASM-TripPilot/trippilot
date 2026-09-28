import fc from 'fast-check';

import type { Place } from '@/entities/place/model';

import { pickTrendingPlaces } from './trendingPlaces';

/**
 * TRIP-1049 · 홈 '지금 뜨는 장소' 고르기 — `GET /places`(최대 200곳, 이름순) 응답에서
 * `savedCount`(담긴 수) 많은 순으로 앞 N곳을 뽑는다(사용자 결정 2026-09-28 · u1 FD F-2 클라 정렬 선례).
 *
 * 무엇을 보장하나:
 *  - 담긴 수 내림차순, **같으면 서버가 준 순서 그대로**(안정 정렬 — 이름순이 남는다).
 *  - 입력 배열을 건드리지 않는다(react-query 캐시 배열을 제자리 정렬하면 다른 화면 순서가 바뀐다).
 *  - 결과는 입력의 원소 그대로다(새 객체를 지어내지 않는다 — 담기에 원본 Place 가 필요하다).
 *
 * 3동작 뼈대: 준비=Place 배열 → 실행=pickTrendingPlaces → 단언=이름 순서.
 *
 * (개념) PBT(속성 기반 테스트) — 예시 몇 개 대신 fast-check 가 무작위 입력을 수백 개 만들어
 * "항상 성립해야 하는 성질"을 확인한다. 담긴 수를 0~5로 좁혀 동점을 일부러 많이 만든다 —
 * 넓히면 동점이 거의 안 나와 "같으면 서버 순서" 성질이 공허하게 통과한다(02a ★10).
 */

/** openapi `Place.required` 필드를 채운다. 이름·담긴 수만 바꾼다. */
function place(nameKo: string, savedCount: number): Place {
  return {
    poiId: `poi-${nameKo}`,
    nameKo,
    category: '명소',
    lat: 35.1,
    lng: 129.0,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount,
    dataStatus: 'ACTIVE',
  };
}

const names = (places: readonly Place[]): string[] =>
  places.map((p) => p.nameKo);

describe('🔴 pickTrendingPlaces — 예시', () => {
  it('P1 · 담긴 수 많은 순 앞 4곳, 동점(5·5)은 서버 순서대로', () => {
    const input = [
      place('영', 0),
      place('오앞', 5),
      place('이', 2),
      place('오뒤', 5),
      place('구', 9),
      place('일', 1),
    ];

    expect(names(pickTrendingPlaces(input, 4))).toEqual([
      '구',
      '오앞',
      '오뒤',
      '이',
    ]);
  });

  it('P2 · 전부 0이면 서버가 준 앞 4곳 그대로(이름순이 남는다)', () => {
    const input = ['가', '나', '다', '라', '마', '바'].map((n) => place(n, 0));

    expect(names(pickTrendingPlaces(input, 4))).toEqual([
      '가',
      '나',
      '다',
      '라',
    ]);
  });

  it('P3 · 4곳보다 적으면 있는 만큼(정렬해서), 빈 목록이면 빈 목록', () => {
    const input = [place('가', 1), place('나', 3), place('다', 2)];

    expect(names(pickTrendingPlaces(input, 4))).toEqual(['나', '다', '가']);
    expect(pickTrendingPlaces([], 4)).toEqual([]);
  });

  it('P4 · 입력 배열의 순서를 바꾸지 않는다(캐시 배열 제자리 정렬 금지)', () => {
    const input = [place('가', 1), place('나', 3), place('다', 2)];
    const before = names(input);

    pickTrendingPlaces(input, 2);

    expect(names(input)).toEqual(before);
  });
});

describe('🔴 pickTrendingPlaces — 속성(PBT)', () => {
  it('길이·내림차순·상위 선택·동점 안정·원소 보존이 항상 성립한다', () => {
    const scenario = fc.record({
      counts: fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 30 }),
      count: fc.integer({ min: 0, max: 6 }),
    });

    fc.assert(
      fc.property(scenario, ({ counts, count }) => {
        const input = counts.map((c, i) => place(`p${i}`, c));
        const indexOf = new Map(input.map((p, i) => [p, i] as const));

        const result = pickTrendingPlaces(input, count);

        // ① 길이 = min(count, 입력 개수)
        expect(result).toHaveLength(Math.min(count, input.length));

        // ② 결과 원소는 입력의 그 객체(같은 참조)이고 중복이 없다
        for (const p of result) expect(indexOf.has(p)).toBe(true);
        expect(new Set(result).size).toBe(result.length);

        // ③ 담긴 수는 앞에서 뒤로 줄거나 같다 · 같으면 입력 순서대로
        for (let i = 1; i < result.length; i += 1) {
          const prev = result[i - 1];
          const cur = result[i];
          expect(prev.savedCount).toBeGreaterThanOrEqual(cur.savedCount);
          if (prev.savedCount === cur.savedCount) {
            expect(indexOf.get(prev)!).toBeLessThan(indexOf.get(cur)!);
          }
        }

        // ④ 뽑힌 것은 안 뽑힌 것보다 담긴 수가 적지 않고, 같으면 입력에서 앞선 것이 뽑힌다
        const chosen = new Set(result);
        for (const c of result) {
          for (const u of input) {
            if (chosen.has(u)) continue;
            expect(c.savedCount).toBeGreaterThanOrEqual(u.savedCount);
            if (c.savedCount === u.savedCount) {
              expect(indexOf.get(c)!).toBeLessThan(indexOf.get(u)!);
            }
          }
        }
      })
    );
  });
});
