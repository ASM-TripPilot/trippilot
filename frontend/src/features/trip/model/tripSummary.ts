import type {
  CompanionType,
  TripDestination,
} from '@/shared/api/generated/schemas';
import { formatDateRangeWithDow } from '@/entities/trip/lib/formatTripPeriod';
import { nightsCountLabel } from '@/entities/trip/lib/formatNights';

/**
 * g01 요약 카드 · 위저드 진행 모델의 순수 셀렉터 (TRIP-664 · US-TRIP-01 · US-TRIP-07).
 * 상태/드래프트를 받아 화면이 그대로 그릴 문자열을 도출한다 — 네트워크·시계·저장소를
 * 건드리지 않는다(기준 날짜는 인자로만 받는다). TRIP-180 `formatPrice`와 동형 병렬 칸.
 */

/** 요약 조인 구분자 ` · ` — 앞뒤 공백 + **U+00B7 미들닷**(마침표 아님). 리포 프로덕션 조인
 *  `(tabs)/index.tsx:129`가 쓰는 그 문자다. 눈으로는 구분되지 않아 상수로 굳혀 둔다. */
const DOT = ` ${'·'} `;

const TOTAL_STEPS = 4;

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' → 에포크 일수(UTC 기준이라 실행 기계의 타임존과 무관). 리포의 다른 model
 *  파일들처럼(`baseSections.ts`·`tripWizardStep1.ts`) 파일마다 사본을 둔다 — 날짜 산술의
 *  표준 규칙일 뿐이라 공유 export로 묶지 않는 관례다. */
function toEpochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
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

/** 요약 행 2톤 — 굵은 main + 같은 줄 회색 sub caption(선택). 화면이 이 객체를 받아 2톤으로
 *  그린다(문자열 하나로 합치지 않는다, TRIP-732). */
export interface SummaryLine {
  main: string;
  sub?: string;
}

/** 취향 행 — main(라벨 조인) + onboarding 플래그. 옛 " + 온보딩" 접미 문자열을 대신해, 화면이
 *  이 불리언으로 스파클+분홍 "온보딩" 배지를 그린다(TRIP-732). */
export interface PreferenceSummary {
  main: string;
  onboarding: boolean;
}

/** 여행지 요약 — main=첫 도시 지역명, sub=첫 도시 박수 + 나머지 도시(`${region} ${nights}박`)를
 *  ` · `로 조인. 0개면 null(미선택). TRIP-732: 문자열 하나 → 2톤 객체(main/sub) 분리. */
export function summaryDestinations(
  destinations: TripDestination[]
): SummaryLine | null {
  if (destinations.length === 0) return null;
  const [first, ...rest] = destinations;
  const subParts = [
    `${first.nights}박`,
    ...rest.map(
      (destination) => `${destination.region} ${destination.nights}박`
    ),
  ];
  return { main: first.region, sub: subParts.join(DOT) };
}

/** 기간 요약 — main="6월 10일(수) – 13일(토)"(요일삽입 날짜범위), sub="3박 4일"(박수 라벨).
 *  요일삽입·박수 라벨은 entities/trip/lib 위임. 한쪽 날짜라도 없으면 null(빈 문자열 아님 —
 *  "미선택"과 "빈 값"은 다른 뜻). TRIP-732: 문자열 하나 → 2톤 객체(main/sub) 분리. */
export function summaryPeriod(
  startDate?: string,
  endDate?: string
): SummaryLine | null {
  if (startDate === undefined || endDate === undefined) return null;
  const nights = toEpochDay(endDate) - toEpochDay(startDate);
  return {
    main: formatDateRangeWithDow(startDate, endDate),
    sub: nightsCountLabel(nights),
  };
}

/** 동행 요약 — 혼자면 main="혼자"(유형이 혼자라 인원을 뗀다, party 무관), 그 외 main="{유형} {party}명"
 *  (party=1이어도 명수를 붙인다). **sub 없음**(동행 행은 2톤이 아니라 main 한 줄). companionType
 *  미정이면 null(D2, 미선택). TRIP-732: 객체형이되 sub 키 자체를 안 둔다. */
export function summaryCompanion(
  companionType: CompanionType | undefined,
  party: number
): SummaryLine | null {
  if (companionType === undefined) return null;
  if (companionType === '혼자') return { main: '혼자' };
  return { main: `${companionType} ${party}명` };
}

/** 취향 요약 — main=labels를 ` · `로 조인, onboarding=fromOnboarding 플래그를 그대로 낸다.
 *  0개면 fromOnboarding과 무관하게 null(D3, 라벨 불가지). TRIP-732: 옛 " + 온보딩" 접미 문자열이
 *  소멸하고 main 은 라벨뿐 — 화면이 onboarding 플래그로 스파클+분홍 배지를 대신 그린다. */
export function summaryPreferences(
  labels: string[],
  fromOnboarding: boolean
): PreferenceSummary | null {
  if (labels.length === 0) return null;
  return { main: labels.join(DOT), onboarding: fromOnboarding };
}

/** 만원 단위 반올림 — 1,234,567 → "123만원"(`Math.round`). export하지 않고 summaryBudget으로만
 *  관찰한다(내부 포맷터, D5). */
function formatManwon(amount: number): string {
  return `${Math.round(amount / 10000)}만원`;
}

/** 예산 요약(2톤) — 금액이 있으면 main=금액("120만원") · sub="1인 총액[ · {tier}]". 금액이 없고
 *  (0 이하) tier 만 있으면 **tier-only**: main=tier("중간") · sub="1인 총액 · 온보딩"(empty 얼굴,
 *  프리필 tier 만 아는 상태). 금액도 tier 도 없으면 null(D4·D5, "0만원"으로 새지 않게 한다).
 *  TRIP-732: 문자열 하나 → 2톤 객체 + tier-only 분기(옛 amount<=0→null 계약 반전). */
export function summaryBudget(
  amount: number,
  tierLabel?: string
): SummaryLine | null {
  if (amount <= 0) {
    if (tierLabel === undefined) return null;
    return { main: tierLabel, sub: `1인 총액${DOT}온보딩` };
  }
  const sub =
    tierLabel === undefined ? '1인 총액' : `1인 총액${DOT}${tierLabel}`;
  return { main: formatManwon(amount), sub };
}
