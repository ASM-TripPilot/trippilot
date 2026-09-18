import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import { findSavedPlaceId, optimisticSavedPlaceId } from './savedPlaceIndex';

/**
 * TRIP-220 AC-5② · 01b Seed Q2 · Q6 — `poiId → savedPlaceId` 역인덱스.
 *
 * 무엇을 보장하나: 카드의 하트는 **poiId**로 그려지는데(탐색 목록이 주는 식별자가 그것뿐)
 * 해제 API는 **savedPlaceId**(담기 기록의 id)를 요구한다. 둘은 다른 값이라
 * `GET /saved-places` 응답에서 뒤집어 찾아야 하고, **못 찾는 경우를 하나로 접는 것**이
 * 이 함수의 실질이다.
 *
 * 왜 훅과 파일이 나뉘어 있나: 이 판정에 필요한 것은 목록과 poiId 둘뿐이라 인자로 받으면
 * 서버도 Query도 목킹하지 않고 전수 검사할 수 있다(같은 슬라이스의 `resolveNearby` 선례).
 * 훅 파일(`savedPlaces.ts`)은 생성 클라이언트 → mutator → `expo-secure-store`까지 정적
 * 그래프를 물고 있어 node 버킷에서 열 수 없다 — `createTripRequest.ts`(순수) ↔
 * `useCreateTrip.ts`(훅)와 같은 분리선이다.
 *
 * 3동작 뼈대: 준비=담은 목록 픽스처 → 실행=findSavedPlaceId → 단언=id 또는 null.
 */

/** openapi `Place.required` 8필드를 전부 채운다 — 픽스처를 상상해서 만들지 않는다. */
function makePlace(poiId: string): Place {
  return {
    poiId,
    nameKo: `장소-${poiId}`,
    category: '명소',
    lat: 33.4589,
    lng: 126.9425,
    region: '제주',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

function makeSaved(poiId: string, savedPlaceId: string): SavedPlace {
  return {
    savedPlaceId,
    savedAt: '2026-08-01T00:00:00Z',
    place: makePlace(poiId),
  };
}

const POI_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const POI_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const POI_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SAVED_ID_B = '22222222-2222-2222-2222-222222222222';

describe('AC-5② · 담긴 poiId를 그 담기 기록 id로 뒤집는다', () => {
  it('담긴 poi면 savedPlaceId를 돌려준다', () => {
    const list = [makeSaved(POI_B, SAVED_ID_B)];

    expect(findSavedPlaceId(list, POI_B)).toBe(SAVED_ID_B);
  });

  it('여러 항목 중 해당 poi의 것을 고른다 (첫 항목을 무조건 돌려주지 않는다)', () => {
    const list = [
      makeSaved(POI_A, '11111111-1111-1111-1111-111111111111'),
      makeSaved(POI_B, SAVED_ID_B),
      makeSaved(POI_C, '33333333-3333-3333-3333-333333333333'),
    ];

    expect(findSavedPlaceId(list, POI_B)).toBe(SAVED_ID_B);
  });

  it('poiId를 부분 문자열로 맞추지 않는다', () => {
    // `includes`/`startsWith` 기반 구현을 잡는다. 이 오탐이 실제로 위험한 이유: 엉뚱한
    // savedPlaceId로 DELETE가 나가면 **남의 담기 기록이 지워지거나** 404가 나는데, 후자는
    // AC-7의 롤백에 흡수되어 조용히 남는다.
    const list = [makeSaved('poi-1', SAVED_ID_B)];

    expect(findSavedPlaceId(list, 'poi-11')).toBeNull();
  });
});

describe('Q2 · Q6 — 보낼 id가 없는 세 경우는 전부 null이다', () => {
  /**
   * 셋을 한 값으로 접는 것이 의도다(01b Seed Q2). 호출자는 어느 쪽이든 "보낼 값이 없다"로
   * 같게 행동한다 — 요청을 보내지 않고 `saved-id-unknown` 사유를 올린다. 갈래를 늘리면 이
   * 칸의 AC에 없는 상태가 새로 생긴다.
   */
  it('그 poi가 목록에 없으면 null', () => {
    expect(findSavedPlaceId([makeSaved(POI_B, SAVED_ID_B)], POI_A)).toBeNull();
  });

  it('빈 목록이면 null', () => {
    expect(findSavedPlaceId([], POI_A)).toBeNull();
  });

  it('목록이 아직 도착하지 않았으면(undefined) 던지지 않고 null (Q2)', () => {
    // 해제에 필요한 값은 `GET /saved-places` 응답에만 있다. 로딩 중에 하트를 누르는 것은
    // 정상 조작이므로 예외로 죽으면 안 된다.
    expect(findSavedPlaceId(undefined, POI_B)).toBeNull();
  });

  it('낙관 표식이 붙어 있는 동안은 null — 서버 id를 아직 모른다 (Q6)', () => {
    // 담기 요청이 날아가는 중에는 목록에 항목이 이미 들어가 있지만(낙관 삽입) 그
    // savedPlaceId는 서버만 아는 값이라 임시 표식이 들어 있다. 이 표식을 그대로 DELETE
    // 경로에 넣으면 404다 — Q2와 같은 경로로 떨어뜨린다.
    const list = [makeSaved(POI_A, optimisticSavedPlaceId(POI_A))];

    expect(findSavedPlaceId(list, POI_A)).toBeNull();
  });
});

describe('Q6 · 낙관 표식의 형식', () => {
  it('optimistic: 접두사 + poiId 다', () => {
    // 값 자체를 01b Seed Q6가 정했다. 여기서 한 번 못 박고, 나머지 테스트는 이 헬퍼를 쓴다
    // — 같은 문자열을 여러 곳에 손으로 적으면 한 곳만 고쳐졌을 때 조용히 어긋난다.
    expect(optimisticSavedPlaceId(POI_A)).toBe(`optimistic:${POI_A}`);
  });
});
