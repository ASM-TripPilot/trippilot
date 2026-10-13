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
 * (기계 강제 없음 — 소스 스캔은 TRIP-1145 에서 지웠다).
 *
 * `budgetForTier`는 예산 tier 칩의 대표 금액이다(TRIP-1256, frontend-components `BudgetInputField`) —
 * 1인 하루 단가 × 여행 일수(`tripDayCount` = 박수 + 1). 인원은 곱하지 않는다(1인 총액).
 * TRIP-1067의 일수 무관 고정 금액은 폐기.
 */
import { nightsSum } from '@/features/create-trip';
import type {
  PreferenceInputBudgetTier,
  TripDestination,
} from '@/shared/api/index.schemas';

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

/**
 * TRIP-1219 b · 1인 총액 상한 — 10억원. 서버(`budget_total bigint`)는 상한이 없고 정본에도 결정이 없어 UX 사본으로
 * 둔다(14자리 99조원이 들어가던 QA 실측). 럭셔리 31일 대표값(1,240만원)의 약 80배라 실제 여행 예산은 다 담는다.
 */
export const MAX_BUDGET_AMOUNT = 1_000_000_000;

export function formatBudgetAmount(amount: number): string {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export type BudgetTier = NonNullable<PreferenceInputBudgetTier>;

/** 1인 하루 단가(TRIP-1256). */
const BUDGET_TIER_DAILY_AMOUNT: Record<BudgetTier, number> = {
  저가: 50000,
  중간: 100000,
  고급: 200000,
  럭셔리: 400000,
};

export function budgetForTier(tier: BudgetTier, days: number): number {
  return BUDGET_TIER_DAILY_AMOUNT[tier] * days;
}

/** 여행 일수 = 박수 합 + 1 — 당일치기·여행지 0곳은 1일. 시작일 유무와 무관하다(TRIP-1256 Q2). */
export function tripDayCount(destinations: TripDestination[]): number {
  return nightsSum(destinations) + 1;
}

/** 서버 응답 tier(`GET /me/preferences` budget.tier — enum 이 아니라 string)가 칩 4값 중 하나인지
 * (TRIP-1107). 판정은 금액표 자기 소유 키로 한다 — 목록을 따로 적으면 금액표와 갈라지고, `in` 은
 * `'toString'` 같은 상속 키에도 참이다. */
export function isBudgetTier(value: string | undefined): value is BudgetTier {
  return (
    value !== undefined &&
    Object.prototype.hasOwnProperty.call(BUDGET_TIER_DAILY_AMOUNT, value)
  );
}

/** 금액 → 등급 역산(TRIP-1091 결정 1) — 하루 금액 기준, 하한 포함·상한 제외. 하루 경계 75,000·150,000·
 * 300,000은 이웃 단가의 중간점이다(TRIP-1256 Q1). 나눗셈 대신 `경계 × 일수`와 정수 비교한다 —
 * 하루 금액을 반올림하면 3일 224,999원(하루 74,999.67원)이 중간으로 넘어간다. */
export function tierForAmount(amount: number, days: number): BudgetTier {
  if (amount < 75000 * days) return '저가';
  if (amount < 150000 * days) return '중간';
  if (amount < 300000 * days) return '고급';
  return '럭셔리';
}
