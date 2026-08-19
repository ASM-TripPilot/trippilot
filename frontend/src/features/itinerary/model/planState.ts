import type {
  ItineraryDaysItem,
  ItineraryGenerationState,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';

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

/**
 * 확정(plan) CTA 를 미리 잠글 것인가 — `generationState==='PARTIAL'`(2단계 생성 중) 한 축뿐이다
 * (01b D2·D3). PARTIAL 동안 확정은 서버가 409 로 거절하는 계약이라(openapi), 눌러 409 만 받는
 * 죽은 활성 버튼을 예방하는 UX 다 — 권위는 서버에 있고 이건 그 사본이다(클라 검증=UX 사본).
 *
 * `resolvePlanState`(위)와 관심사가 달라 이웃 export 로 둔다 — 저건 *얼굴*을, 이건 *확정 가능
 * 여부*를 가른다(TRIP-401 의 `resolveItineraryDestination` 과 같은 분리). status 축과 독립이라
 * status 는 보지 않는다(계약: generationState ⊥ status · AC-7).
 */
export function isConfirmLocked(
  generationState?: ItineraryGenerationState
): boolean {
  return generationState === 'PARTIAL';
}

/**
 * TRIP-401 · 일정 진입 시 **어느 화면으로 보낼지**(목적지)를 정하는 순수 판정.
 *
 * `resolvePlanState`(위)와 관심사가 다르다 — 저건 *한 화면 안의 얼굴*을, 이건 *어느 화면*을
 * 고른다. 그래서 이웃 export 로 새로 두고 `resolvePlanState` 는 건드리지 않는다. 두 진입점(홈
 * 카드 CTA·일정 탭)이 **같은 이 함수를 호출**해 규칙이 한 곳에만 산다(AC-5).
 *
 * 우선순위: 404(없음)→method · PARTIAL(생성 중)→generating · FAILED(2차 실패, 1차분 유효)→draft ·
 * CONFIRMED(확정=읽기전용)→plan · 그 외(COMPLETE+PLANNED, 미확정 초안)→draft. generationState 는
 * status 와 독립 축이라(계약) 진행 상태를 확정 상태보다 먼저 본다(BR-U3-04/07/28 성격에서 파생).
 */
export type ItineraryDestination = 'method' | 'generating' | 'draft' | 'plan';

export function resolveItineraryDestination(input: {
  notFound: boolean;
  generationState?: ItineraryGenerationState;
  status?: ItineraryStatus;
}): ItineraryDestination {
  if (input.notFound) return 'method';
  if (input.generationState === 'PARTIAL') return 'generating';
  if (input.generationState === 'FAILED') return 'draft';
  if (input.status === 'CONFIRMED') return 'plan';
  return 'draft';
}

/**
 * 목적지 토큰 + tripId → **문자열** 라우트 href. 두 진입점이 같은 조립기를 써 "plan 만 접미
 * 없음" 특례가 한 곳에만 산다 — Redirect·push 관찰이 String(href) 기반이라 객체 href 는 금지다.
 *
 * 반환 타입은 각 라우트를 그대로 담은 템플릿 리터럴 유니온이다 — 순수 문자열(`string`)로 두면
 * `typedRoutes` 가 `router.push`/`Redirect href` 에서 거부한다(라우트 파일에서 인라인 템플릿만
 * 문맥 타이핑돼 통과하므로, 조립기를 밖에 두려면 라우트 타입을 직접 실어야 한다). expo-router 를
 * import 하지 않아 이 model 층은 라우팅 무지로 남는다.
 */
export type ItineraryDestinationHref =
  | `/trips/${string}/itinerary`
  | `/trips/${string}/itinerary/method`
  | `/trips/${string}/itinerary/generating`
  | `/trips/${string}/itinerary/draft`;

export function itineraryDestinationHref(
  tripId: string,
  destination: ItineraryDestination
): ItineraryDestinationHref {
  switch (destination) {
    case 'method':
      return `/trips/${tripId}/itinerary/method`;
    case 'generating':
      return `/trips/${tripId}/itinerary/generating`;
    case 'draft':
      return `/trips/${tripId}/itinerary/draft`;
    case 'plan':
      return `/trips/${tripId}/itinerary`;
  }
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
