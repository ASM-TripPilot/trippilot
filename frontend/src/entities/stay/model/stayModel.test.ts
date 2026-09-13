import type {
  StayItem,
  SavedStay,
  StayPrice,
  StayCardVM,
  SavedStayCardVM,
} from '@/entities/stay/model';

/**
 * TRIP-807 · AC-1 — entities/stay/model 이 stay 도메인의 **공개 창구**임을 잠근다(806 placeModel 동형).
 *
 * 무엇을 보장하나:
 *  - 🔴 서버 계약 타입(`StayItem`·`SavedStay`·`StayPrice`)을 entities 가 **재수출**한다 — 새 타입을
 *    만드는 게 아니라 `@/shared/api/generated` 의 원본을 그대로 다시 내보내(re-export) "여기가 stay
 *    도메인 진입점"이라는 표시. 서버 계약의 정본은 여전히 `shared/api`(`api` 세그먼트 0).
 *  - 🔴 카드 뷰모델 `StayCardVM`(검색 레인)·`SavedStayCardVM`(저장 degrade)을 entities 가 **정의**한다 —
 *    지금은 `ExploreLandingScreen`·`SavedStayListScreen` 로컬에 있던 것을 이리로 옮긴다(바이트 동일 형태).
 *
 * *(개념 — re-export)*: `export type { StayItem } from '@/shared/api/...'` 처럼 원본을 그대로 다시
 *  내보내는 것. 이 파일이 존재하지 않으면 위 import 가 모듈 해석에 실패해 테스트가 red 로 죽는다(TDD).
 *  타입 import 는 런타임에 지워지므로, 계약 형태로 객체를 구성해 "타입이 있다"를 tsc 가 심판한다.
 *
 * 3동작 뼈대: 준비=entities/stay/model import → 실행=계약 형태 객체 구성 → 단언=키 존재·형태 일치.
 */

describe('🔴 AC-1 · entities/stay/model 재수출 + 카드 뷰모델', () => {
  it('M1-1 · StayItem·SavedStay·StayPrice 타입이 재수출된다(계약 형태로 구성 가능)', () => {
    // 재수출이 없으면 tsc red. 런타임에선 구성 객체의 키 존재만 확인한다.
    const price: StayPrice = { amount: 120000, currency: 'KRW' };
    const item: StayItem = {
      externalSource: 'NAVER',
      externalId: 's1',
      name: '해운대 오션뷰',
      lat: 35.16,
      lng: 129.16,
      region: '부산 해운대구',
      amenities: ['조식'],
      stayType: 'HOTEL',
      price,
    };
    const saved: SavedStay = {
      savedStayId: 'ss-1',
      name: '해운대 오션뷰',
      coordConfirmed: true,
      registerRoute: 'MAP_SEARCH',
      createdAt: '2026-09-13T00:00:00Z',
      updatedAt: '2026-09-13T00:00:00Z',
    };

    expect(item).toHaveProperty('externalId', 's1');
    expect(item.price).toHaveProperty('amount', 120000);
    expect(saved).toHaveProperty('savedStayId', 'ss-1');
  });

  it('M1-2 · StayCardVM 을 정의한다(key·name·region·priceText)', () => {
    const vm = {
      key: 'NAVER:s1',
      name: '해운대 오션뷰',
      region: '부산 해운대구',
      priceText: '120,000원~',
    } satisfies StayCardVM;

    expect(vm).toEqual({
      key: 'NAVER:s1',
      name: '해운대 오션뷰',
      region: '부산 해운대구',
      priceText: '120,000원~',
    });
  });

  it('M1-3 · SavedStayCardVM 을 정의한다(savedStayId·name + 옵셔널 dateLabel)', () => {
    // dateLabel 은 옵셔널 — 생략해도 컴파일된다(계약에 날짜가 없으면 미표시, INV-3 준수).
    const bare = {
      savedStayId: 'ss-1',
      name: '해운대 오션뷰',
    } satisfies SavedStayCardVM;
    const withDate = {
      savedStayId: 'ss-2',
      name: '광안리 스테이',
      dateLabel: '6.10~6.13',
    } satisfies SavedStayCardVM;

    expect(bare).toEqual({ savedStayId: 'ss-1', name: '해운대 오션뷰' });
    expect(withDate).toHaveProperty('dateLabel', '6.10~6.13');
  });
});
