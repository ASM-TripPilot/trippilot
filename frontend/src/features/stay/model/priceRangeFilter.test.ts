import type { StayItem } from '@/shared/api/generated/schemas';

import {
  PRICE_BUCKETS,
  filterByPriceRange,
  type PriceBucketId,
} from './priceRangeFilter';

/**
 * TRIP-457 AC-12 — e02 가격대 칩 "복구"의 코어 순수 함수(01b Q4 (a) 클라이언트 가격대 필터).
 *
 * `/stays/search` 에 price 파라미터가 없어(계약 공백) 서버 필터가 불가하므로, 응답 `items` 를
 * `price.amount` 로 프리셋 버킷 필터한다. 화면·페이지가 아니라 이 순수 함수가 판정을 소유한다.
 *
 * 경계(발명 — 01b Q4 검토 대기, 서버 price 파라미터가 생기면 서버 필터로 승격):
 *  - all         → 전량(필터 안 함)
 *  - under-100k  → amount < 100000
 *  - 100k-200k   → 100000 ≤ amount < 200000  (하한 포함·상한 제외 = 반개구간)
 *  - over-200k   → amount ≥ 200000
 * 가격 결측(price == null)은 특정 버킷에선 제외(범위 판정 불가), all 엔 포함 — formatPrice 의
 * `== null` 존재판정과 같은 규약(BR-U1-14, `amount: 0` 을 falsy 로 접지 않기 위함).
 *
 * *(개념)* `toEqual` = 값 깊은 비교. `not.toBe` = 참조 비동일(새 배열인지). `.map(...)` 으로
 * 결과 금액만 뽑아 비교하면 어떤 item 이 남았는지가 한눈에 보인다.
 */

function item(amount: number | null, externalId: string): StayItem {
  return {
    externalSource: 'NAVER',
    externalId,
    name: `숙소-${externalId}`,
    lat: 35.1,
    lng: 129.1,
    region: '부산',
    amenities: [],
    stayType: 'HOTEL',
    price: amount === null ? null : { amount, currency: 'KRW' },
  };
}

const ITEMS: StayItem[] = [
  item(50000, 'a'),
  item(100000, 'b'),
  item(150000, 'c'),
  item(200000, 'd'),
  item(250000, 'e'),
  item(null, 'f'), // 가격 미확인
];

function amounts(list: StayItem[]): (number | null | undefined)[] {
  return list.map((it) => it.price?.amount ?? null);
}

describe('U1 · all 은 전량을 순서 그대로, 새 배열로 돌려준다 (BR-U1-15)', () => {
  it('입력을 값으로는 같게, 참조로는 다르게(비파괴) 돌려준다', () => {
    const result = filterByPriceRange(ITEMS, 'all');

    expect(result).toEqual(ITEMS); // 순서·내용 동일
    expect(result).not.toBe(ITEMS); // 캐시 소유 배열을 제자리 안 건드린다
  });
});

describe('U2·U3·U4 · 버킷 경계 (반개구간)', () => {
  it('under-100k 는 100000 미만만 남긴다 (100000 경계 제외)', () => {
    expect(amounts(filterByPriceRange(ITEMS, 'under-100k'))).toEqual([50000]);
  });

  it('100k-200k 는 하한 포함·상한 제외', () => {
    expect(amounts(filterByPriceRange(ITEMS, '100k-200k'))).toEqual([
      100000, 150000,
    ]);
  });

  it('over-200k 는 200000 포함 이상', () => {
    expect(amounts(filterByPriceRange(ITEMS, 'over-200k'))).toEqual([
      200000, 250000,
    ]);
  });
});

describe('U5 · 가격 결측 처리 (★F-7)', () => {
  it('특정 버킷 3종에는 price null item 이 안 들어오고, all 에는 들어온다', () => {
    const specific: PriceBucketId[] = ['under-100k', '100k-200k', 'over-200k'];
    specific.forEach((bucket) => {
      expect(amounts(filterByPriceRange(ITEMS, bucket))).not.toContain(null);
    });
    // all 은 null 가격도 유지한다(전량).
    expect(amounts(filterByPriceRange(ITEMS, 'all'))).toContain(null);
  });
});

describe('U6 · 비파괴 (visiblePlaces 선례)', () => {
  it('필터 후 입력 배열이 그대로다', () => {
    const snapshot = amounts(ITEMS);
    filterByPriceRange(ITEMS, 'over-200k');
    expect(amounts(ITEMS)).toEqual(snapshot);
  });
});

describe('U7 · PRICE_BUCKETS 목록', () => {
  it('버킷은 4개이고 첫 항목이 all 이며 id 집합이 정확하다', () => {
    expect(PRICE_BUCKETS).toHaveLength(4);
    expect(PRICE_BUCKETS[0].id).toBe('all');
    expect(PRICE_BUCKETS.map((b) => b.id)).toEqual([
      'all',
      'under-100k',
      '100k-200k',
      'over-200k',
    ]);
  });
});
