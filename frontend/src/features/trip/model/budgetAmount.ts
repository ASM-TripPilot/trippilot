/**
 * 예산 총액의 표시값(콤마 포함 문자열) ↔ 전송값(정수) 변환 (TRIP-207 AC-3 · AC-5, 01b D7 · D8).
 *
 * `parseBudgetAmount`는 세 갈래로 갈린다 — 빈 값(공백만도 포함)은 오류가 아니라 `empty`
 * (키 생략, AC-2), 숫자로 읽히면 `amount`(0 포함, ★2), 그 밖은 `invalid`(전송 금지 + 오류
 * 표시, AC-4). 콤마는 표시용 장식으로 보고 자리를 안 따지며 걷어낸다(`1,2,3` → 123).
 *
 * `Number()`가 조용히 통과시키는 `''`·`' '`·`'1e3'`·`'0x10'`·`'Infinity'` 같은 입력을
 * 걸러내려고 ASCII 숫자만 허용하는 `/^\d+$/`로 판정한다 — `\d*`(별표)로 쓰면 `','`가 콤마
 * 제거 뒤 빈 문자열이 되어 매치되고 0원으로 조용히 접힌다.
 *
 * `formatBudgetAmount`는 `formatPrice.ts`가 세운 천단위 구분 규칙을 그대로 쓴다.
 * `toLocaleString`/`Intl`을 쓰지 않는다 — 테스트는 node, 앱은 Hermes에서 돌아 로케일
 * 서식이 갈릴 수 있고, 그 갈림을 동작 테스트가 원리적으로 못 본다
 * (`src/__tests__/tripBudgetStructure.test.ts`가 소스 층에서 대신 잠근다).
 */
export type BudgetAmount =
  { kind: 'empty' } | { kind: 'amount'; amount: number } | { kind: 'invalid' };

export function parseBudgetAmount(raw: string): BudgetAmount {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { kind: 'empty' };
  }

  const digitsOnly = trimmed.replace(/,/g, '');
  if (!/^\d+$/.test(digitsOnly)) {
    return { kind: 'invalid' };
  }

  return { kind: 'amount', amount: Number(digitsOnly) };
}

export function formatBudgetAmount(amount: number): string {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
