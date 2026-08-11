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

/** 날짜탭 메타 — `dayIndex` 는 1부터, `count` 는 각 날의 슬롯 수. */
export function buildPlanDayTabs(days: ItineraryDaysItem[]): PlanDayTab[] {
  return days.map((day, index) => ({
    dayIndex: index + 1,
    date: day.date,
    count: day.slots.length,
  }));
}
