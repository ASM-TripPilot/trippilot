import type { StayItem } from '@/shared/api/generated/schemas';

/**
 * 숙소 항목의 단일 식별 출처(AC-6 · 01b Seed Q1). `StayItem`에 계약상 `stayId`가 없어
 * `externalSource`+`externalId`를 합성한다 — 공급자가 다르면 `externalId`가 같아도
 * 충돌하지 않는다. React 리스트 `key`와 카드 testID(`stay-card-{stayKey}` 등)가 전부
 * 이 함수 하나에서만 나온다(단일 출처).
 *
 * `Pick<>`으로 두 필드만 받는다 — 호출부(`StayItem` 전체)는 구조적으로 그대로 들어맞고,
 * 단위 테스트는 두 필드짜리 객체만 만들면 된다.
 */
export function stayKey(
  item: Pick<StayItem, 'externalSource' | 'externalId'>
): string {
  return `${item.externalSource}:${item.externalId}`;
}
