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

/** 구간 라벨 구분자 — **en dash U+2013**. `baseSections.ts`가 박수 라벨에 쓰는 것과 같은
 * 문자이고, 하이픈과 눈으로 구분되지 않아 여기서도 상수로 이름을 붙인다. */
const EN_DASH = '–';

/** 나열 상한(01b D16) — `blockedNotice`가 1줄 고정이라 넘치면 CTA를 밀어낸다. */
const UNRESOLVED_LIMIT = 2;

/** 'YYYY-MM-DD' → `6/10`. 0 패딩을 떼는 것이 이 함수의 전부다(Figma는 `06/10`이 아니다). */
function monthDay(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

/** 구간 행 날짜 — `6/10–6/12`. */
export function formatSectionRange(dateFrom: string, dateTo: string): string {
  return `${monthDay(dateFrom)}${EN_DASH}${monthDay(dateTo)}`;
}

/** 섹션 부제 — `6월 10일–13일`. 같은 달이면 둘째 월을 생략한다(Figma 실측). 달을 넘는
 * 갈래(`6월 30일–7월 2일`)는 Figma가 그리지 않아 이 칸의 결정이다(02a §5-6 I-6). */
export function formatTripRange(startDate: string, endDate: string): string {
  const [, startMonth, startDay] = startDate.split('-');
  const [, endMonth, endDay] = endDate.split('-');
  const tail =
    startMonth === endMonth
      ? `${Number(endDay)}일`
      : `${Number(endMonth)}월 ${Number(endDay)}일`;
  return `${Number(startMonth)}월 ${Number(startDay)}일${EN_DASH}${tail}`;
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
