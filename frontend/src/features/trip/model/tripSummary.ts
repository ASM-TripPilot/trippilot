import type {
  CompanionType,
  TripDestination,
} from '@/shared/api/generated/schemas';

import { dayOfWeek } from './tripWizardStep1';

/**
 * g01 요약 카드 · 위저드 진행 모델의 순수 셀렉터 (TRIP-664 · US-TRIP-01 · US-TRIP-07).
 * 상태/드래프트를 받아 화면이 그대로 그릴 문자열을 도출한다 — 네트워크·시계·저장소를
 * 건드리지 않는다(기준 날짜는 인자로만 받는다). TRIP-180 `formatPrice`와 동형 병렬 칸.
 */

/** 요약 조인 구분자 ` · ` — 앞뒤 공백 + **U+00B7 미들닷**(마침표 아님). 리포 프로덕션 조인
 *  `(tabs)/index.tsx:129`가 쓰는 그 문자다. 눈으로는 구분되지 않아 상수로 굳혀 둔다. */
const DOT = ` ${'·'} `;

/** 기간 범위 구분자 — **en dash U+2013**(하이픈이 아니다). `baseSections.ts`·`planState.ts`가
 *  같은 문자를 쓴다. */
const EN_DASH = '–';

/** 0=일 … 6=토 → 한글 요일 한 글자. `dayOfWeek`(tripWizardStep1)의 반환 인덱스와 짝이 맞는다
 *  (에포크 0 = 목요일 기준이라 `getUTCDay`와 같은 순서). */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

const TOTAL_STEPS = 4;

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' → 에포크 일수(UTC 기준이라 실행 기계의 타임존과 무관). 리포의 다른 model
 *  파일들처럼(`baseSections.ts`·`tripWizardStep1.ts`) 파일마다 사본을 둔다 — 날짜 산술의
 *  표준 규칙일 뿐이라 공유 export로 묶지 않는 관례다. */
function toEpochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** 'YYYY-MM-DD' → [월, 일] 숫자. 문자열을 그대로 쪼개므로 시계를 안 읽는다. */
function monthDay(date: string): [month: number, day: number] {
  const [, month, day] = date.split('-').map(Number);
  return [month, day];
}

/** current를 [1, total=4]로 접는다(D1). 범위 밖(0·5·음수)이 안전한 경계값으로 접혀
 *  "5 / 4"·"0 / 4" 같은 표시가 새지 않는다. */
function clampStep(current: number): number {
  return Math.min(TOTAL_STEPS, Math.max(1, current));
}

/** 진행 모델 — 클램프한 current + 상수 total=4(D1). */
export function wizardProgress(current: number): {
  current: number;
  total: number;
} {
  return { current: clampStep(current), total: TOTAL_STEPS };
}

/** 진행 표시 문자열 `"N / 4"` — 옛 하드코딩 `"1 / 2"`·`"2 / 2"`의 단일 대체 소스(D1).
 *  wizardProgress와 같은 클램프를 타 범위 밖 값이 표시로 새지 않는다. */
export function formatWizardStep(current: number): string {
  return `${clampStep(current)} / ${TOTAL_STEPS}`;
}

/** 여행지 요약 — 각 도시 `${region} ${nights}박`을 ` · `로 조인. 0개면 null(미선택). */
export function summaryDestinations(
  destinations: TripDestination[]
): string | null {
  if (destinations.length === 0) return null;
  return destinations
    .map((destination) => `${destination.region} ${destination.nights}박`)
    .join(DOT);
}

/** 요일을 각 일자 뒤에 얹은 기간 범위 문자열. 같은 달이면 둘째 월 표기를 생략한다
 *  (`formatConfirmedDateRange` 관례). 요일은 `dayOfWeek`(에포크 산술)로 구해 시계를 안 읽는다. */
function formatDateRangeWithDow(startDate: string, endDate: string): string {
  const [startMonth, startDay] = monthDay(startDate);
  const [endMonth, endDay] = monthDay(endDate);
  const startDow = WEEKDAYS[dayOfWeek(toEpochDay(startDate))];
  const endDow = WEEKDAYS[dayOfWeek(toEpochDay(endDate))];

  const head = `${startMonth}월 ${startDay}일(${startDow})`;
  const tail =
    startMonth === endMonth
      ? `${endDay}일(${endDow})`
      : `${endMonth}월 ${endDay}일(${endDow})`;
  return `${head} ${EN_DASH} ${tail}`;
}

/** 기간 요약 — "6월 10일(수) – 13일(토) · 3박 4일". 요일은 실제 달력값이다. 한쪽 날짜라도
 *  없으면 null(빈 문자열 아님 — "미선택"과 "빈 값"은 다른 뜻). */
export function summaryPeriod(
  startDate?: string,
  endDate?: string
): string | null {
  if (startDate === undefined || endDate === undefined) return null;
  const nights = toEpochDay(endDate) - toEpochDay(startDate);
  const nightsLabel = `${nights}박 ${nights + 1}일`;
  return `${formatDateRangeWithDow(startDate, endDate)}${DOT}${nightsLabel}`;
}

/** 동행 요약 — 혼자면 "혼자"(유형이 혼자라 인원을 뗀다, party 무관), 그 외 "{유형} {party}명"
 *  (party=1이어도 명수를 붙인다). companionType 미정이면 null(D2, 미선택). */
export function summaryCompanion(
  companionType: CompanionType | undefined,
  party: number
): string | null {
  if (companionType === undefined) return null;
  if (companionType === '혼자') return '혼자';
  return `${companionType} ${party}명`;
}

/** 취향 요약 — labels를 ` · `로 조인, fromOnboarding이면 " + 온보딩" 접미. 0개면
 *  fromOnboarding과 무관하게 null(D3, 라벨 불가지) — 빈 판정을 먼저 해 " + 온보딩"이 새지 않는다. */
export function summaryPreferences(
  labels: string[],
  fromOnboarding: boolean
): string | null {
  if (labels.length === 0) return null;
  const joined = labels.join(DOT);
  return fromOnboarding ? `${joined} + 온보딩` : joined;
}

/** 만원 단위 반올림 — 1,234,567 → "123만원"(`Math.round`). export하지 않고 summaryBudget으로만
 *  관찰한다(내부 포맷터, D5). */
function formatManwon(amount: number): string {
  return `${Math.round(amount / 10000)}만원`;
}

/** 예산 요약 — "120만원 · 1인 총액 · 중간". tierLabel 없으면 tier 절 생략. amount가 0 이하면
 *  tier 유무와 무관하게 null(D4·D5) — 0을 명시적으로 걸러 "0만원"으로 새지 않게 한다. */
export function summaryBudget(
  amount: number,
  tierLabel?: string
): string | null {
  if (amount <= 0) return null;
  const base = `${formatManwon(amount)}${DOT}1인 총액`;
  return tierLabel === undefined ? base : `${base}${DOT}${tierLabel}`;
}
