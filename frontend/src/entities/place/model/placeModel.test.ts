import { PoiCategory } from '@/entities/place/model';
import type { Place, PlaceCardVM, SavedPlace } from '@/entities/place/model';

/**
 * TRIP-806 · AC-M1 — entities/place/model 이 place 도메인의 **공개 창구**임을 잠근다.
 *
 * 무엇을 보장하나:
 *  - 🔴 서버 계약 타입(`Place`·`PoiCategory`·`SavedPlace`)을 entities 가 **재수출**한다 — 새 타입을
 *    만드는 게 아니라 `@/shared/api/generated` 의 원본을 그대로 다시 내보내(re-export) "여기가 place
 *    도메인 진입점"이라는 표시. 서버 계약의 정본은 여전히 `shared/api`(`api` 세그먼트 0).
 *  - 🔴 `PlaceCardVM`(레인 카드 경량 뷰모델)을 entities 가 **정의**한다 — 지금은 `ExploreLandingScreen`
 *    로컬에 있던 것을 이리로 옮긴다(바이트 동일 형태).
 *
 * *(개념 — re-export)*: `export { PoiCategory } from '@/shared/api/...'` 처럼 원본을 그대로 다시
 *  내보내는 것. 이 파일이 존재하지 않으면 아래 import 가 모듈 해석에 실패해 테스트가 red 로 죽는다(TDD).
 *
 * 3동작 뼈대: 준비=entities/place/model import → 실행=값·타입 사용 → 단언=값 동일·형태 일치.
 */

describe('🔴 AC-M1 · entities/place/model 재수출 + PlaceCardVM', () => {
  it('M1-1 · PoiCategory 를 재수출한다(7종, 값이 생성 원본과 동일)', () => {
    // 준비·실행: 재수출된 런타임 const 를 읽는다.
    // 단언: 7종 키가 그대로이고 각 값이 한글 라벨 그대로다(어댑터 없는 얇은 재수출).
    expect(Object.keys(PoiCategory).sort()).toEqual(
      ['명소', '맛집', '카페', '야경', '자연', '쇼핑', '문화'].sort()
    );
    expect(PoiCategory.명소).toBe('명소');
    expect(PoiCategory.문화).toBe('문화');
  });

  it('M1-2 · Place·SavedPlace 타입이 재수출된다(계약 형태로 구성 가능)', () => {
    // 타입 import 는 런타임에 지워지므로, 계약 형태로 객체를 구성해 "타입이 있다"를 tsc 가 심판한다
    // (재수출이 없으면 tsc red). 런타임에선 구성 객체의 키 존재만 확인한다.
    const place: Place = {
      poiId: 'p1',
      nameKo: '감천문화마을',
      category: PoiCategory.명소,
      lat: 35.0,
      lng: 129.0,
      region: '부산 사하구',
      openingHours: null,
      imageUrl: null,
      tags: ['골목'],
      savedCount: 3,
      dataStatus: 'ACTIVE',
    };
    const saved: SavedPlace = {
      savedPlaceId: 'sp-1',
      savedAt: '2026-09-13T00:00:00Z',
      place,
    };

    expect(place).toHaveProperty('poiId', 'p1');
    expect(saved).toHaveProperty('savedPlaceId', 'sp-1');
    expect(saved.place).toHaveProperty('nameKo', '감천문화마을');
  });

  it('M1-3 · PlaceCardVM 을 정의한다(poiId·name·region + 옵셔널 imageUrl)', () => {
    // imageUrl 은 옵셔널 — 생략해도 컴파일된다(레인 카드 회색 자리, INV-1).
    const vm = {
      poiId: 'p1',
      name: '감천문화마을',
      region: '부산 사하구',
    } satisfies PlaceCardVM;
    const vmWithPhoto = {
      poiId: 'p2',
      name: '광안리',
      region: '부산 수영구',
      imageUrl: 'https://example.com/a.jpg',
    } satisfies PlaceCardVM;

    expect(vm).toEqual({
      poiId: 'p1',
      name: '감천문화마을',
      region: '부산 사하구',
    });
    expect(vmWithPhoto).toHaveProperty('imageUrl');
  });
});
