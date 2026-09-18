import type { StayItem } from '@/shared/api/generated/schemas';

import { buildSaveStayRequest } from './buildSaveStayRequest';

/**
 * TRIP-417 AC-1 (+ 01b Seed Q2·Q3) — 검색결과 `StayItem` → `POST /saved-stays` 요청 본문 조립.
 *
 * 무엇을 보장하나: OTA 검색결과를 위시리스트로 담을 때 서버로 보내는 `RegisterSavedStayRequest`가
 * 정확히 이 모양이다 — `registerRoute:'MAP_SEARCH'`(정본 공백을 오케가 결정, 좌표 출처에 최근접)와
 * `coordConfirmed:true`(검색결과 `StayItem`은 `lat`/`lng`가 required라 신뢰 가능한 좌표를 이미
 * 가진다 — TRIP-600 A안: "좌표 존재 = 확정", INV-U1-08 재정의)를 이 함수 한 곳에 박아, 화면·훅
 * 어디서도 이 두 값을 다시 정하지 않게 한다.
 *
 * TRIP-600 프리즈 교체: 이 파일은 예전에 `coordConfirmed:false`를 리터럴로 동결했다. 그 값이
 * e02/d01에서 담은 숙소를 g02 거점 배정에서 롱프레스 없이는 못 쓰게 막았고(TRIP-490 근본원인),
 * 사용자 구술("좌표가 있는데 찍어야 된다 이건 말이 안 돼")이 그 계약을 뒤집었다 — 이제 `true`로
 * 동결한다. 값만 바뀌고 키 7개는 그대로다(아래 첫 케이스가 키 집합을 별도로 잠근다).
 *
 * 왜 순수 함수·별도 파일인가: 매핑을 서버/Query 목킹 없이 단위로 잠글 수 있고, 훅 파일이 무는
 * 정적 그래프(mutator → expo-secure-store)와 분리돼 node 버킷에서 열린다.
 *
 * 3동작 뼈대: 준비=StayItem → 실행=buildSaveStayRequest → 단언=키 완전일치 + 값 완전일치.
 */

/** openapi `StayItem.required` 필드를 전부 채운다(price만 옵셔널). */
const ITEM: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '서면 시티 호텔',
  lat: 35.1577,
  lng: 129.0594,
  region: '서면',
  amenities: ['wifi'],
  stayType: 'HOTEL',
  price: { amount: 10000, currency: 'KRW' },
};

describe('AC-1 · buildSaveStayRequest — 정확히 7키로 조립한다', () => {
  it('키 집합이 정확히 {name, registerRoute, coordConfirmed, externalSource, externalId, lat, lng}다', () => {
    // 준비·실행
    const req = buildSaveStayRequest(ITEM);

    // 단언 — 키를 완전일치로 잠근다(정렬 후 비교). checkIn/checkOut/memo 같은 여분 키가 새면
    // red다: 검색결과엔 날짜·메모가 없고, 키 부재와 null 전송은 서버에 다른 뜻이다(AC-5 stayRegisterForm 선례).
    expect(Object.keys(req).sort()).toEqual([
      'coordConfirmed',
      'externalId',
      'externalSource',
      'lat',
      'lng',
      'name',
      'registerRoute',
    ]);
  });

  it('registerRoute=MAP_SEARCH · coordConfirmed=true로 고정하고 나머지는 item 값 그대로다', () => {
    // 실행
    const req = buildSaveStayRequest(ITEM);

    // 단언 — 값 완전일치. 두 결정(MAP_SEARCH·true)을 리터럴로 못 박아, 누가 false/다른 경로로
    // 바꾸면 사람 눈에 보이고 테스트가 red를 낸다. TRIP-600 A안: 검색결과는 신뢰 가능한 좌표를
    // 이미 가지므로 담는 순간이 곧 확정이다(false는 g02 거점 배정을 막던 옛 계약 — 프리즈 교체).
    expect(req).toEqual({
      name: '서면 시티 호텔',
      registerRoute: 'MAP_SEARCH',
      coordConfirmed: true,
      externalSource: 'NAVER',
      externalId: 's1',
      lat: 35.1577,
      lng: 129.0594,
    });
  });

  it('다른 item으로도 name·외부키·좌표가 그대로 실린다 (값 하드코딩 방지)', () => {
    // 준비 — 위 리터럴 단언이 상수를 그대로 되돌려주는 구현으로도 통과하지 않게 다른 값으로 한 번 더.
    const other: StayItem = {
      externalSource: 'AGODA',
      externalId: 'x99',
      name: '광안리 오션뷰',
      lat: 35.1531,
      lng: 129.1186,
      region: '광안리',
      amenities: ['ocean'],
      stayType: 'PENSION',
      price: null,
    };

    // 실행·단언
    expect(buildSaveStayRequest(other)).toEqual({
      name: '광안리 오션뷰',
      registerRoute: 'MAP_SEARCH',
      coordConfirmed: true,
      externalSource: 'AGODA',
      externalId: 'x99',
      lat: 35.1531,
      lng: 129.1186,
    });
  });
});
