import type { SavedStay, StayItem } from '@/shared/api/generated/schemas';

import { findSavedStayId, optimisticSavedStayId } from './savedStayIndex';

/**
 * TRIP-417 AC-2·AC-3 (+ Q6) — `(externalSource, externalId) → savedStayId` 역인덱스.
 *
 * 무엇을 보장하나: 카드의 하트는 검색결과 `StayItem`(외부키만 있다)로 그려지는데, 해제 API는
 * **savedStayId**(담기 기록의 id)를 요구한다. 둘은 다른 값이라 `GET /saved-stays` 응답에서
 * 뒤집어 찾아야 하고, **못 찾는 경우를 하나로 접는 것**이 이 함수의 실질이다.
 * explore d04 `savedPlaceIndex.ts`의 stay 판 — 매칭 키만 poiId → (externalSource+externalId)로 다르다.
 *
 * 왜 훅과 파일이 나뉘어 있나: 이 판정에 필요한 것은 목록과 item 둘뿐이라 인자로 받으면 서버도
 * Query도 목킹하지 않고 전수 검사할 수 있다(같은 슬라이스 순수 함수 선례). 훅 파일
 * (`savedStays.ts`)은 생성 클라이언트 → mutator → `expo-secure-store`까지 정적 그래프를 물고
 * 있어 node 버킷에서 열 수 없다 — `savedPlaceIndex.ts` ↔ `savedPlaces.ts`와 같은 분리선이다.
 *
 * 3동작 뼈대: 준비=담은 목록 픽스처 → 실행=findSavedStayId → 단언=id 또는 null.
 */

/** openapi `SavedStay.required` 6필드를 전부 채운다 — 픽스처를 상상해서 만들지 않는다.
 * externalSource/externalId는 선택·nullable이라 인자로 받아 케이스마다 다르게 준다. */
function makeSaved(
  savedStayId: string,
  externalSource: string | null,
  externalId: string | null
): SavedStay {
  return {
    savedStayId,
    name: `숙소-${savedStayId}`,
    coordConfirmed: false,
    registerRoute: 'MAP_SEARCH',
    externalSource,
    externalId,
    lat: 35.1587,
    lng: 129.1604,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

/** 매칭에 필요한 두 외부키만 있으면 된다(findSavedStayId는 `Pick`으로 받는다). */
function itemOf(externalSource: string, externalId: string): StayItem {
  return {
    externalSource,
    externalId,
    name: `검색결과-${externalId}`,
    lat: 35.1587,
    lng: 129.1604,
    region: '해운대',
    amenities: [],
    stayType: 'HOTEL',
  };
}

const SAVED_ID = '22222222-2222-2222-2222-222222222222';

describe('AC-2 · 담긴 숙소를 그 담기 기록 id로 뒤집는다', () => {
  it('externalSource·externalId가 둘 다 맞으면 savedStayId를 돌려준다', () => {
    const list = [makeSaved(SAVED_ID, 'NAVER', 's1')];

    expect(findSavedStayId(list, itemOf('NAVER', 's1'))).toBe(SAVED_ID);
  });

  it('여러 항목 중 해당 숙소의 것을 고른다 (첫 항목을 무조건 돌려주지 않는다)', () => {
    const list = [
      makeSaved('11111111-1111-1111-1111-111111111111', 'NAVER', 's2'),
      makeSaved(SAVED_ID, 'NAVER', 's1'),
      makeSaved('33333333-3333-3333-3333-333333333333', 'NAVER', 's3'),
    ];

    expect(findSavedStayId(list, itemOf('NAVER', 's1'))).toBe(SAVED_ID);
  });
});

describe('AC-3 · 매칭 키는 externalSource+externalId 짝이다', () => {
  it('externalId가 같아도 externalSource가 다르면 그 항목은 아니다', () => {
    // 공급자가 다르면 externalId가 겹쳐도 다른 숙소다(stayKey가 두 값을 합성하는 이유).
    const list = [
      makeSaved('other-provider-id', 'AGODA', 's1'),
      makeSaved(SAVED_ID, 'NAVER', 's1'),
    ];

    expect(findSavedStayId(list, itemOf('NAVER', 's1'))).toBe(SAVED_ID);
  });

  it('externalId를 부분 문자열로 맞추지 않는다', () => {
    // includes/startsWith 기반 구현을 잡는다. 엉뚱한 savedStayId로 DELETE가 나가면 남의 담기
    // 기록이 지워지거나 404가 나는데, 후자는 AC-4의 롤백에 흡수되어 조용히 남는다.
    const list = [makeSaved(SAVED_ID, 'NAVER', 's1')];

    expect(findSavedStayId(list, itemOf('NAVER', 's11'))).toBeNull();
  });

  it('externalSource·externalId가 null인 SavedStay(핀·수동)는 매칭 불가 → 무시', () => {
    // 검색결과 item의 외부키는 계약상 non-null string이라, null-외부키 담기 기록과는 strict
    // 등가로 자동 탈락한다("NAVER" !== null). 핀/수동 등록 숙소가 검색 카드를 잘못 채우지 않는다.
    const list = [makeSaved('pin-1', null, null)];

    expect(findSavedStayId(list, itemOf('NAVER', 's1'))).toBeNull();
  });
});

describe('Q6 · 보낼 id가 없는 경우는 전부 null이다', () => {
  it('그 숙소가 목록에 없으면 null', () => {
    const list = [makeSaved(SAVED_ID, 'NAVER', 's2')];

    expect(findSavedStayId(list, itemOf('NAVER', 's1'))).toBeNull();
  });

  it('빈 목록이면 null', () => {
    expect(findSavedStayId([], itemOf('NAVER', 's1'))).toBeNull();
  });

  it('목록이 아직 도착하지 않았으면(undefined) 던지지 않고 null', () => {
    // 해제에 필요한 값은 GET /saved-stays 응답에만 있다. 로딩 중에 하트를 누르는 것은 정상
    // 조작이므로 예외로 죽으면 안 된다.
    expect(findSavedStayId(undefined, itemOf('NAVER', 's1'))).toBeNull();
  });

  it('낙관 표식이 붙어 있는 동안은 null — 서버 id를 아직 모른다', () => {
    // 담기 요청이 날아가는 중에는 목록에 항목이 이미 들어가 있지만(낙관 삽입) 그 savedStayId는
    // 서버만 아는 값이라 임시 표식이 들어 있다. 그대로 DELETE 경로에 넣으면 404다.
    const list = [makeSaved(optimisticSavedStayId('NAVER:s1'), 'NAVER', 's1')];

    expect(findSavedStayId(list, itemOf('NAVER', 's1'))).toBeNull();
  });
});

describe('Q6 · 낙관 표식의 형식', () => {
  it('optimistic: 접두사 + key(externalSource:externalId) 다', () => {
    // 값 자체를 이 파일이 한 번 못 박고, 나머지 테스트는 이 헬퍼를 쓴다 — 같은 문자열을 여러
    // 곳에 손으로 적으면 한 곳만 고쳐졌을 때 조용히 어긋난다.
    expect(optimisticSavedStayId('NAVER:s1')).toBe('optimistic:NAVER:s1');
  });
});
