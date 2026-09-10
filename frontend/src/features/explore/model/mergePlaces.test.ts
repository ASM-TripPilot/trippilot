import type { Place } from '@/shared/api/generated/schemas';

import { mergePlacesByPoiId } from './mergePlaces';

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
