import type { DayCoverage } from '@/shared/api/generated/schemas';

/**
 * g02 거점 숙소 화면이 그릴 **문자열**을 만드는 순수 함수들(TRIP-225). 네트워크·시계를
 * 건드리지 않는다.
 *
 * 서식이 둘로 갈리는 이유는 Figma가 두 자리에서 다르게 적었기 때문이다 — 구간 행은
 * `6/10–6/12`(`1861:2318`), 섹션 부제는 `6월 10일–13일`(`1861:2312`). 기존
 * `formatDateRange`(`tripWizardStep1.ts`)는 `6월 10일 – 6월 13일`이라 셋이 서로 다르다.
 *
 * 미해결 날짜 나열은 **`AUTO`가 아닌 것 전부**를 센다(01b D16). "나쁜 상태를 열거"하는 대신
 * "좋은 상태를 배제"하는 형태라, 서버가 상태를 하나 더 늘려도 이 파일은 안 깨진다. 나열이
 * 비는 것과 진행을 막는 것은 별개다 — 막을 권위는 `Coverage.blocked` 하나다(D16-b · INV-2).
 */

// TRIP-808 재수출 shim — formatSectionRange·formatTripRange 본체는 entities/trip/lib 로 바이트 이관됐다
// (807 formatPrice 선례). 옛 경로(`@/features/trip/model/baseScreen`)를 무는 무수정 소비처·테스트
// (baseScreen.test·(tabs)/index)가 그대로 green 이 되게 한 줄만 남긴다. unresolvedDaysView 는 여기 존치.
export {
  formatSectionRange,
  formatTripRange,
} from '@/entities/trip/lib/formatTripPeriod';

/** 나열 상한(01b D16) — `blockedNotice`가 1줄 고정이라 넘치면 CTA를 밀어낸다. */
const UNRESOLVED_LIMIT = 2;

/** 'YYYY-MM-DD' → `6/10`. 0 패딩을 떼는 것이 이 함수의 전부다(Figma는 `06/10`이 아니다). */
function monthDay(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

export interface UnresolvedDaysView {
  /** 앞 `UNRESOLVED_LIMIT`개. 서버가 준 순서를 그대로 지킨다. */
  items: { date: string; label: string }[];
  /** 접힌 나머지 수 — 0이면 접미를 안 붙인다. */
  overflowCount: number;
}

export function unresolvedDaysView(days: DayCoverage[]): UnresolvedDaysView {
  const unresolved = days.filter((day) => day.status !== 'AUTO');
  return {
    items: unresolved.slice(0, UNRESOLVED_LIMIT).map((day) => ({
      date: day.date,
      label: monthDay(day.date),
    })),
    overflowCount: Math.max(0, unresolved.length - UNRESOLVED_LIMIT),
  };
}
