import type { StayItem } from '@/shared/api/generated/schemas';

/**
 * e02 가격대 칩 "복구"의 코어 순수 함수(TRIP-457 AC-12 · 01b Q4 (a)).
 *
 * `/stays/search`에 price 파라미터가 없어(계약 공백) 서버 필터가 불가하므로, 응답 `items`를
 * `price.amount`로 프리셋 버킷 필터한다. 판정을 화면·페이지가 아니라 이 순수 함수가 소유한다.
 *
 * 경계(발명 — 01b Q4 검토 대기, 서버 price 파라미터가 생기면 서버 필터로 승격):
 *  - all         → 전량(필터 안 함)
 *  - under-100k  → amount < 100000
 *  - 100k-200k   → 100000 ≤ amount < 200000  (하한 포함·상한 제외 = 반개구간)
 *  - over-200k   → amount ≥ 200000
 *
 * 가격 결측(`price == null`)은 특정 버킷 3종에선 제외(범위 판정 불가), `all`엔 포함 —
 * `formatPrice`의 `== null` 존재판정과 같은 규약(BR-U1-14, `amount: 0`을 falsy로 접지 않기 위함).
 *
 * 입력 배열은 비파괴로 다룬다(캐시가 소유한 배열을 제자리 정렬/필터하지 않는다 —
 * `visiblePlaces`·`orderSavedPlaces` 선례). 항상 새 배열을 돌려준다.
 */

export type PriceBucketId = 'all' | 'under-100k' | '100k-200k' | 'over-200k';

export const PRICE_BUCKETS: { id: PriceBucketId; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'under-100k', label: '10만원 이하' },
  { id: '100k-200k', label: '10만~20만원' },
  { id: 'over-200k', label: '20만원 이상' },
];

/** 반개구간 판정 — 결측 가격은 호출부(filterByPriceRange)가 먼저 걸러 여기 안 온다. */
function amountInBucket(amount: number, bucketId: PriceBucketId): boolean {
  switch (bucketId) {
    case 'under-100k':
      return amount < 100000;
    case '100k-200k':
      return amount >= 100000 && amount < 200000;
    case 'over-200k':
      return amount >= 200000;
    case 'all':
      return true;
  }
}

export function filterByPriceRange(
  items: StayItem[],
  bucketId: PriceBucketId
): StayItem[] {
  // all 은 순서 그대로 전량을 새 배열로(BR-U1-15 서버 순서, 정렬/필터 없음).
  if (bucketId === 'all') {
    return [...items];
  }
  return items.filter((item) => {
    // 결측(price == null)은 특정 버킷에서 제외 — 범위를 판정할 값이 없다(★F-7).
    if (item.price == null) {
      return false;
    }
    return amountInBucket(item.price.amount, bucketId);
  });
}
