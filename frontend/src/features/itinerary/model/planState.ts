import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-299 · h25 완성 일정 시간표 뷰의 순수 판정/조립.
 *
 * 화면(`ui/TimelineScreen`)은 이 값들을 다시 계산하지 않는다 — 판정이 두 층에 흩어지면 같은
 * 규칙이 서로 다르게 진화한다(`draftView.ts` 와 같은 배치).
 *
 * 날짜 계산은 `draftView.ts` 와 같은 이유로 **UTC 고정**이다 — 로컬 시간대로 다루면 KST(+9)에선
 * 무해하지만 UTC-x(CI)에선 하루가 밀린다.
 */

const MS_PER_DAY = 86_400_000;

export type PlanState =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'failed' }
  | { kind: 'listed'; days: ItineraryDaysItem[] };

export interface PlanDayTab {
  dayIndex: number;
  date: string;
  count: number;
}

/** `'YYYY-MM-DD'` → UTC 자정의 밀리초. 형식이 아니면 `NaN` — 호출부가 빈 결과로 갈라낸다. */
function utcDayTime(date: string): number {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (parts === null) return Number.NaN;
  return Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

/**
 * 로딩·404·실패·목록을 **우선순위대로** 하나의 얼굴로 가른다(loading > notFound > failed > listed).
 *
 * 404 는 `notFound` 이자 `failed`(조회가 던진다)이기도 하다 — 순서가 이 겹침을 가른다. "일정이
 * 아직 없다"(notFound)는 전면 실패 얼굴이 아니라 별도 얼굴이라 앞선다.
 */
export function resolvePlanState(input: {
  loading: boolean;
  notFound: boolean;
  failed: boolean;
  days: ItineraryDaysItem[];
}): PlanState {
  if (input.loading) return { kind: 'loading' };
  if (input.notFound) return { kind: 'notFound' };
  if (input.failed) return { kind: 'failed' };
  return { kind: 'listed', days: input.days };
}

/** `'YYYY-MM-DD'` 두 개 → `'N박 M일'`. 형식이 아니거나 끝이 시작보다 앞서면 빈 문자열. */
export function formatNightsLabel(startDate: string, endDate: string): string {
  const start = utcDayTime(startDate);
  const end = utcDayTime(endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '';

  const nights = Math.round((end - start) / MS_PER_DAY);
  return `${nights}박 ${nights + 1}일`;
}

/**
 * `'YYYY-MM-DD'` 두 개 → 확정 배너 날짜범위(TRIP-300 · D3). 같은 달이면 끝 날짜의 월을 빼
 * `'6월 10일 – 13일'`, 달이 바뀌면 양쪽 월을 넣어 `'6월 30일 – 7월 2일'`. 연도는 표기하지 않는다.
 * 구분자는 en-dash `–`(U+2013) 앞뒤 공백. 형식이 아니거나 역방향이면 `formatNightsLabel` 과 같은
 * 가드로 빈 문자열이다. 월·일은 `getUTC*` 로 읽는다 — `utcDayTime` 이 UTC 자정이라 UTC-x(CI)에서도
 * 안 밀린다.
 */
export function formatConfirmedDateRange(
  startDate: string,
  endDate: string
): string {
  const start = utcDayTime(startDate);
  const end = utcDayTime(endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '';

  const startAt = new Date(start);
  const endAt = new Date(end);
  const startMonth = startAt.getUTCMonth() + 1;
  const endMonth = endAt.getUTCMonth() + 1;
  const head = `${startMonth}월 ${startAt.getUTCDate()}일`;
  const tail =
    startMonth === endMonth
      ? `${endAt.getUTCDate()}일`
      : `${endMonth}월 ${endAt.getUTCDate()}일`;
  return `${head} – ${tail}`;
}

/** 날짜탭 메타 — `dayIndex` 는 1부터, `count` 는 각 날의 슬롯 수. */
export function buildPlanDayTabs(days: ItineraryDaysItem[]): PlanDayTab[] {
  return days.map((day, index) => ({
    dayIndex: index + 1,
    date: day.date,
    count: day.slots.length,
  }));
}
