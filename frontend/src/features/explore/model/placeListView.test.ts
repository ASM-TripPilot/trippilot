import type { Place } from '@/shared/api/generated/schemas';

import { visiblePlaces } from './placeListView';

/**
 * AC-7(정렬) · AC-8(검색) — d04 목록의 **클라이언트 가공** 의미론.
 *
 * 무엇을 보장하나: `GET /places` 응답을 화면에 그리기 전에 (1) 이름 부분일치로 좁히고
 * (2) `savedCount` 내림차순으로 정렬하며 (3) 입력 배열을 건드리지 않는다.
 *
 * 왜 순수 함수로 떼어 재는가: 계약에 `q`·정렬 파라미터가 없어 이 판정 전부가 클라 몫인데,
 * 화면 렌더로 재면 "정렬이 틀린 것"과 "카드가 안 그려진 것"이 같은 red 로 보인다.
 * 서버 재조회가 없다는 것(AC-7·AC-8 후반절)은 요청을 세야 하므로 통합 버킷이 맡는다
 * (`PlaceExplorePage.integration.test.tsx`).
 *
 * ★ 이 함수는 **TanStack Query 캐시가 소유한 배열**을 그대로 받는다(페이지가 `data`를 넘긴다).
 *   제자리 정렬(`places.sort(...)`)은 캐시를 그 자리에서 망가뜨린다 — it 6 이 그 자리를 잠근다.
 */

/** openapi `Place` 의 required 필드를 전부 채운다 — 픽스처를 상상해서 만들지 않는다. */
function makePlace(
  poiId: string,
  nameKo: string,
  category: Place['category'],
  region: string | null,
  savedCount: number
): Place {
  return {
    poiId,
    nameKo,
    category,
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

/**
 * 입력 순서를 savedCount 오름차순·내림차순·이름순 **어느 것과도 다르게** 골랐다.
 * 그래야 "정렬하지 않고 서버 순서를 그대로 돌려주는" 구현이 우연히 통과하지 않는다.
 */
const PLACES: Place[] = [
  makePlace('p1', '감천문화마을', '명소', '사하구', 12),
  makePlace('p2', '광안리 해변', '야경', '수영구', 30),
  makePlace('p3', '전포 카페거리', '카페', null, 7),
  makePlace('p4', '해동용궁사', '명소', '기장군', 3),
  makePlace('p5', '자갈치 시장', '맛집', '중구', 21),
  makePlace('p6', '해운대 해변', '자연', '해운대구', 40),
];

function ids(places: Place[]): string[] {
  return places.map((place) => place.poiId);
}

describe('visiblePlaces — 정렬 (AC-7)', () => {
  it('savedCount 내림차순으로 정렬한다', () => {
    // 기대값은 계산식이 아니라 리터럴이다 — 이 순서가 맞는지가 게이트①에서 사람 눈에
    // 보여야 심판 노릇을 한다.
    expect(ids(visiblePlaces(PLACES, ''))).toEqual([
      'p6',
      'p2',
      'p5',
      'p1',
      'p3',
      'p4',
    ]);
  });

  it('savedCount 가 같으면 받은 순서를 유지한다', () => {
    const tied: Place[] = [
      makePlace('t1', '가나다', '명소', '중구', 5),
      makePlace('t2', '나다라', '맛집', '중구', 5),
      makePlace('t3', '다라마', '카페', '중구', 5),
    ];

    // 동점을 이름·카테고리 같은 이차 기준으로 다시 가르면 계약에 없는 판정을 발명하는 것이다
    // (01b Seed Q8 이 "지금 뜨는 순"을 뺀 것과 같은 이유).
    expect(ids(visiblePlaces(tied, ''))).toEqual(['t1', 't2', 't3']);
  });
});

describe('visiblePlaces — 검색 (AC-8)', () => {
  it('nameKo 에 검색어가 포함된 항목만 남기고, 남은 것도 정렬한다', () => {
    // '해변'은 p2(30)·p6(40) 둘을 남긴다. 입력 순서는 p2 → p6 이므로, 결과가 p6 → p2 라는 것이
    // 곧 "거른 뒤에도 정렬이 적용됐다"는 뜻이다(둘을 한 단언으로 잰다).
    expect(ids(visiblePlaces(PLACES, '해변'))).toEqual(['p6', 'p2']);
    expect(ids(visiblePlaces(PLACES, '해'))).toEqual(['p6', 'p2', 'p4']);
  });

  it('빈 검색어·공백만이면 전체를 돌려준다', () => {
    // "입력하지 않음"과 "일치 없음"은 다르다(`filterRegions` 와 같은 규칙).
    expect(ids(visiblePlaces(PLACES, ''))).toHaveLength(6);
    expect(ids(visiblePlaces(PLACES, '   '))).toHaveLength(6);
    expect(ids(visiblePlaces(PLACES, '   '))[0]).toBe('p6');
  });

  it('일치가 없으면 빈 배열이다 — 전체로 되돌리지 않는다', () => {
    expect(visiblePlaces(PLACES, '없는이름')).toEqual([]);
  });

  it('이름 밖(카테고리·지역)으로 새지 않는다', () => {
    // 긍정 짝 — 필터가 실제로 무언가를 남긴다. 이게 없으면 아래 두 빈 배열이 "필터가 전부
    // 버리는" 구현에서도 공허하게 통과한다.
    expect(ids(visiblePlaces(PLACES, '해변'))).toEqual(['p6', 'p2']);

    // '야경'은 p2 의 category, '중구'는 p5 의 region 이다 — nameKo 에는 없다.
    expect(visiblePlaces(PLACES, '야경')).toEqual([]);
    expect(visiblePlaces(PLACES, '중구')).toEqual([]);
  });
});

describe('visiblePlaces — 입력 배열 비변형', () => {
  it('원본 배열의 순서를 바꾸지 않고 새 배열을 돌려준다', () => {
    const input = [...PLACES];
    const before = ids(input);

    const result = visiblePlaces(input, '');

    // 제자리 정렬(`input.sort(...)`)이면 여기서 red 다 — 실기에서는 Query 캐시가 소유한
    // 배열이 그 자리에서 뒤바뀐다.
    expect(ids(input)).toEqual(before);
    expect(result).not.toBe(input);
  });
});
