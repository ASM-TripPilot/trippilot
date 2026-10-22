import fc from 'fast-check';

import type { Place } from '@/shared/api/index.schemas';

import { interleavePlacesByRegion, mergePlacesByPoiId } from './mergePlaces';

/**
 * TRIP-687 · 다지역 '꼭 갈 곳 더 담기'의 병합·중복제거 순수 함수.
 *
 * 무엇을 보장하나: 지역별로 따로 받아온 장소 목록 여러 개를 하나로 합치되,
 * (1) 모든 지역의 장소가 다 들어가고(AC-1) (2) 같은 poiId 가 겹치면 한 번만 남기며
 * 첫 등장 순서를 지키고(AC-2) (3) 각 Place 의 값(지역명 등)을 건드리지 않는다(AC-6).
 *
 * 왜 순수 함수로 떼어 재는가: 이 병합/dedup 을 페이지 인라인에 두면 jest 가 원리적으로
 * 못 보는 배선 지대에 숨는다(traps-explore·traps-trip "페이지 배선 무심판"). 그래서
 * 이 사이클의 주 심판은 여기다 — 실제 화면에 두 지역 장소가 함께 뜨는지는 6-b 실기 몫이다.
 */

/** openapi `Place` 의 required 필드를 전부 채운다 — 픽스처를 상상해서 만들지 않는다.
 * `savedCount` 를 인자로 받아 "같은 poiId 를 두 리스트에 서로 다른 값으로" 넣을 수 있게 한다
 * (첫 등장 우선을 확인하는 재료). */
function makePlace(
  poiId: string,
  nameKo: string,
  region: string | null,
  savedCount: number
): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region,
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount,
    dataStatus: 'ACTIVE',
  };
}

function ids(places: Place[]): string[] {
  return places.map((place) => place.poiId);
}

describe('mergePlacesByPoiId — 병합 (AC-1)', () => {
  it('지역A 2건 + 지역B 2건을 합쳐 4건, A·B 가 모두 포함된다', () => {
    const regionA = [
      makePlace('a1', '감천마을', '부산광역시', 12),
      makePlace('a2', '광안리', '부산광역시', 30),
    ];
    const regionB = [
      makePlace('b1', '첨성대', '경주시', 8),
      makePlace('b2', '불국사', '경주시', 40),
    ];

    // 기대값은 리터럴이다 — 이 순서·구성이 맞는지가 게이트①에서 사람 눈에 보여야 심판 노릇을 한다.
    expect(ids(mergePlacesByPoiId([regionA, regionB]))).toEqual([
      'a1',
      'a2',
      'b1',
      'b2',
    ]);
  });
});

describe('mergePlacesByPoiId — 중복제거 (AC-2)', () => {
  it('두 지역에 같은 poiId 가 겹치면 한 번만, 첫 등장 순서를 지킨다', () => {
    const regionA = [
      makePlace('p1', '감천마을', '부산광역시', 12),
      makePlace('p2', '광안리', '부산광역시', 30),
    ];
    const regionB = [
      makePlace('p2', '광안리', '경주시', 99), // A 의 p2 와 겹친다
      makePlace('p3', '전포', '경주시', 7),
    ];

    // p2 는 하나만, 순서는 [p1, p2, p3] — filter 로 전부 지우거나 마지막 등장을 남기는 구현이면 red.
    expect(ids(mergePlacesByPoiId([regionA, regionB]))).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('겹칠 때 첫 등장(먼저 온 리스트)의 값이 남는다', () => {
    const regionA = [makePlace('p2', '광안리', '부산광역시', 30)];
    const regionB = [makePlace('p2', '광안리', '경주시', 99)];

    const merged = mergePlacesByPoiId([regionA, regionB]);

    // 첫 등장(A)의 savedCount·region 이 살아남는다 — "나중 것으로 덮어쓰기"가 아니라 "첫 것 유지".
    expect(merged).toHaveLength(1);
    expect(merged[0].savedCount).toBe(30);
    expect(merged[0].region).toBe('부산광역시');
  });
});

describe('mergePlacesByPoiId — 값 무변형 (AC-6)', () => {
  it('병합이 Place 의 값(지역명 등)을 바꾸지 않는다', () => {
    const busan = makePlace('a1', '감천마을', '부산광역시', 12);
    const gyeongju = makePlace('b1', '첨성대', '경주시', 8);

    const merged = mergePlacesByPoiId([[busan], [gyeongju]]);

    // 지역명이 표준명 원문 그대로 통과한다(축약·정규화 없음) + 나머지 필드도 전부 그대로.
    expect(merged[0]).toEqual(busan);
    expect(merged[1]).toEqual(gyeongju);
    expect(merged[0].region).toBe('부산광역시');
  });
});

describe('mergePlacesByPoiId — 경계', () => {
  it('빈 입력이면 빈 배열이다', () => {
    expect(mergePlacesByPoiId([])).toEqual([]);
    expect(mergePlacesByPoiId([[], []])).toEqual([]);
  });

  it('리스트가 하나면 그 목록을 그대로 돌려주되, 새 배열이다', () => {
    const only = [
      makePlace('a1', '감천마을', '부산광역시', 12),
      makePlace('a2', '광안리', '부산광역시', 30),
    ];

    const merged = mergePlacesByPoiId([only]);

    expect(ids(merged)).toEqual(['a1', 'a2']);
    // 캐시가 소유한 원본 배열을 그대로 반환하면 호출부가 제자리 정렬 등으로 캐시를 망친다.
    expect(merged).not.toBe(only);
  });
});

/**
 * TRIP-1563 · d04 무작위 순서의 3지역 병합 `interleavePlacesByRegion`.
 *
 * 무엇을 보장하나: 지역별 목록(각자 서버가 시드로 섞어 준 것)을 지역 블록으로 이어 붙이지 않고
 * **라운드 로빈**(서울1·부산1·제주1·서울2…)으로 번갈아 놓는다(AC-8). 개수·지역 안 순서·poiId 중복 0 은
 * 지키고, 사진 유무로는 순서를 바꾸지 않는다(티켓 결정 1 — 홈 레인의 `orderLanePlaces` 와 다르다).
 *
 * 개념 하나: **라운드 로빈**은 줄 선 여러 목록에서 한 장씩 차례로 뽑고, 다 쓴 목록은 건너뛰는 방식이다.
 */
function placeWithImage(place: Place): Place {
  return { ...place, imageUrl: `https://img.example/${place.poiId}.jpg` };
}

describe('interleavePlacesByRegion — 라운드 로빈 (AC-8)', () => {
  it('지역을 번갈아 한 곳씩 놓고, 다 쓴 지역은 건너뛴다', () => {
    const seoul = ['s1', 's2', 's3'].map((id) => makePlace(id, id, '서울', 1));
    const busan = [makePlace('b1', 'b1', '부산', 1)];
    const jeju = ['j1', 'j2'].map((id) => makePlace(id, id, '제주', 1));

    // 앞 3개가 서로 다른 지역(서울·부산·제주)이고, 부산이 소진된 뒤엔 서울·제주만 남아 번갈아 간다.
    expect(ids(interleavePlacesByRegion([seoul, busan, jeju]))).toEqual([
      's1',
      'b1',
      'j1',
      's2',
      'j2',
      's3',
    ]);
  });

  it('사진이 있고 없고는 순서에 영향이 없다 — 사진 없는 곳이 앞에 와도 그대로다', () => {
    const seoul = [
      makePlace('s1', 's1', '서울', 1), // 사진 없음
      placeWithImage(makePlace('s2', 's2', '서울', 1)),
    ];
    const busan = [makePlace('b1', 'b1', '부산', 1)]; // 사진 없음

    // 사진 있는 곳을 먼저 모으는 구현(orderLanePlaces 류)이면 s2 가 앞서 이 단언이 red.
    expect(ids(interleavePlacesByRegion([seoul, busan]))).toEqual([
      's1',
      'b1',
      's2',
    ]);
  });

  it('세 지역이 같은 장소를 주면 중복 없이 한 번씩만 남는다', () => {
    const five = () =>
      ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => makePlace(id, id, '부산', 1));

    // 교차만 하고 중복 제거를 안 하면 p1,p1,p1,p2… 가 된다.
    expect(ids(interleavePlacesByRegion([five(), five(), five()]))).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
    ]);
  });

  it('빈 입력은 빈 배열이고, 리스트가 하나면 같은 순서의 새 배열이다', () => {
    const only = [
      makePlace('a1', 'a1', '부산', 1),
      makePlace('a2', 'a2', '부산', 1),
    ];

    expect(interleavePlacesByRegion([])).toEqual([]);
    expect(interleavePlacesByRegion([[], []])).toEqual([]);
    const merged = interleavePlacesByRegion([only]);
    expect(ids(merged)).toEqual(['a1', 'a2']);
    expect(merged).not.toBe(only);
  });

  it('입력 배열을 제자리에서 바꾸지 않는다', () => {
    const a = Object.freeze([
      makePlace('a1', 'a1', '서울', 1),
      makePlace('a2', 'a2', '서울', 1),
    ]) as Place[];
    const b = Object.freeze([makePlace('b1', 'b1', '부산', 1)]) as Place[];
    const before = [[...a], [...b]];

    // 얼린 배열에 push/sort 하면 TypeError 로 던진다.
    expect(() => interleavePlacesByRegion([a, b])).not.toThrow();
    expect([[...a], [...b]]).toEqual(before);
  });
});

describe('interleavePlacesByRegion — 성질 (PBT)', () => {
  /** 리스트 i 의 j 번째 장소의 poiId 는 `r{i}-{j}` — 전역 유일해서 "어느 리스트의 몇 번째"를 id 로 되읽는다. */
  const listsArb = fc
    .array(fc.integer({ min: 0, max: 6 }), { maxLength: 5 })
    .map((lengths) =>
      lengths.map((length, i) =>
        Array.from({ length }, (_, j) => makePlace(`r${i}-${j}`, 'n', null, 0))
      )
    );
  const origin = (id: string): { list: number; index: number } => {
    const [, list, index] = /^r(\d+)-(\d+)$/.exec(id) ?? [];
    return { list: Number(list), index: Number(index) };
  };

  it('개수가 보존되고 중복이 없으며 지역 안 순서가 그대로다', () => {
    fc.assert(
      fc.property(listsArb, (lists) => {
        const out = ids(interleavePlacesByRegion(lists));

        expect(out).toHaveLength(lists.reduce((n, l) => n + l.length, 0));
        expect(new Set(out).size).toBe(out.length);
        lists.forEach((list, i) => {
          expect(out.filter((id) => origin(id).list === i)).toEqual(ids(list));
        });
      })
    );
  });

  it('라운드 단위로 놓인다 — 각 리스트의 j 번째가 모두 나온 뒤에야 j+1 번째가 시작하고, 첫 라운드는 리스트 순서다', () => {
    fc.assert(
      fc.property(listsArb, (lists) => {
        const out = ids(interleavePlacesByRegion(lists)).map(origin);

        // 리스트 안 위치가 비감소 — 블록(서울 전부 → 부산 전부) 배치면 0,1,2,0,1… 로 내려가 깨진다.
        for (let k = 1; k < out.length; k += 1) {
          expect(out[k].index).toBeGreaterThanOrEqual(out[k - 1].index);
        }
        // 첫 라운드: 비어 있지 않은 리스트마다 하나씩, 리스트 번호 오름차순.
        const nonEmpty = lists
          .map((l, i) => (l.length > 0 ? i : -1))
          .filter((i) => i >= 0);
        expect(out.slice(0, nonEmpty.length).map((o) => o.list)).toEqual(
          nonEmpty
        );
      })
    );
  });

  it('poiId 가 겹쳐도 중복 없이 합집합 그대로다 (누가 이기는지는 계약 밖)', () => {
    const idArb = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f');
    const overlapArb = fc.array(
      fc
        .uniqueArray(idArb, { maxLength: 6 })
        .map((idList) => idList.map((id) => makePlace(id, 'n', null, 0))),
      { maxLength: 4 }
    );

    fc.assert(
      fc.property(overlapArb, (lists) => {
        const out = ids(interleavePlacesByRegion(lists));
        const union = new Set(lists.flatMap((l) => ids(l)));

        expect(new Set(out).size).toBe(out.length);
        expect(new Set(out)).toEqual(union);
      })
    );
  });
});
