import type { StayPrice } from '@/shared/api/generated/schemas';

/**
 * 최저가 스냅숏 → 카드 금액 문자열 (US-STAY-01 · BR-U1-12/14 · INV-3).
 *
 * 존재 판정은 `== null`이다 — `!price?.amount`로 쓰면 `amount === 0`이 falsy라
 * "0원~"이 조용히 "가격 미확인"으로 접힌다(D-Q3).
 *
 * 천단위 구분에 `toLocaleString`/`Intl`을 쓰지 않는다 — 테스트는 node, 앱은 Hermes에서
 * 돌아 로케일 서식 결과가 갈릴 수 있고, 그 갈림을 테스트가 원리적으로 못 본다(01b D5).
 *
 * ponytail: amount 상한 방어는 두지 않는다 — JS 정수 정밀도는
 * Number.MAX_SAFE_INTEGER(2^53-1 = 9,007,199,254,740,991)까지만 보장된다. 그
 * 위부터 int64 계약 상한(9,223,372,036,854,775,807)까지는 계약상 유효한 amount인데도
 * 이미 정밀도를 잃어(예: 9,007,199,254,740,993 → 9,007,199,254,740,992로 접힘)
 * 상한 검사를 추가해도 막을 수 없다. 실제 숙박가가 닿을 수 없는 구간이라 서버 쪽
 * 방어가 필요해지면 그때 추가한다.
 */
export function formatPrice(price?: StayPrice | null): string {
  if (price == null) {
    return '가격 미확인';
  }

  const grouped = String(price.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}원~`;
}
