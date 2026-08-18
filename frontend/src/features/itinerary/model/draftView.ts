import type {
  ItineraryCandidatesSummary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  ItineraryGenerationState,
  ItinerarySolveMode,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-297 · h11 초안 화면의 순수 판정 5종 + 폴링 상수 2종.
 *
 * 화면(`ui/DraftScreen`)은 이 값들을 다시 계산하지 않는다 — 판정이 두 층에 흩어지면 같은
 * 규칙이 서로 다르게 진화한다(`mustVisitList.ts` 와 같은 배치).
 *
 * 날짜 계산은 전부 **UTC 고정**이다. `new Date('2026-06-10')` 를 로컬 시간대로 다루면
 * KST(+9)에서는 무해하지만 UTC-x 환경(CI)에서는 하루가 밀린다.
 */

/** 정본 부재 — 01b Seed 가 정한 이 사이클의 발명값(간격 2초 · 상한 30회 ≒ 60초). */
export const DRAFT_POLL_INTERVAL_MS = 2000;
export const DRAFT_POLL_MAX_COUNT = 30;

const MS_PER_DAY = 86_400_000;
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/** `'YYYY-MM-DD'` → UTC 자정의 밀리초. 형식이 아니면 `NaN` — 호출부가 빈 결과로 갈라낸다. */
function utcDayTime(date: string): number {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (parts === null) return Number.NaN;
  return Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

export interface DraftDayTab {
  date: string;
  /** 여행 며칠째인가 — testID `itinerary-draft-day-{n}` 의 n. */
  dayNumber: number;
  /** 그 날짜의 슬롯이 이미 도착했나. false 면 탭이 비활성이다. */
  hasData: boolean;
}

/**
 * 날짜 탭은 **여행 기간**에서 나오고 `days` 는 활성 여부만 정한다(01b D7).
 *
 * 서버가 day1 만 담은 `PARTIAL` 을 먼저 주는 2단계 생성이라, `days.length` 로 탭을 세면
 * 폴링 도중 탭이 하나였다가 셋으로 늘어난다 — 여행 길이는 처음부터 알고 있는 값이다.
 */
export function buildDraftDayTabs(input: {
  startDate: string;
  endDate: string;
  days: ItineraryDaysItem[];
}): DraftDayTab[] {
  const start = utcDayTime(input.startDate);
  const end = utcDayTime(input.endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const arrived = new Set(input.days.map((day) => day.date));
  const tabs: DraftDayTab[] = [];
  for (let time = start; time <= end; time += MS_PER_DAY) {
    const date = new Date(time).toISOString().slice(0, 10);
    tabs.push({
      date,
      dayNumber: tabs.length + 1,
      hasData: arrived.has(date),
    });
  }
  return tabs;
}

/** `'2026-06-10'` → `'6월 10일 · 수'`. 요일은 달력에서 계산한다(Figma 목업의 요일은 틀렸다). */
export function formatDraftDayHeader(date: string): string {
  const time = utcDayTime(date);
  if (Number.isNaN(time)) return '';

  const at = new Date(time);
  const weekday = WEEKDAY_LABELS[at.getUTCDay()];
  return `${at.getUTCMonth() + 1}월 ${at.getUTCDate()}일 · ${weekday}`;
}

export interface DraftPin {
  /** 카드 번호(배열 인덱스+1)를 그대로 쓴다 — 아래 주석 참조. */
  number: number;
  lat: number;
  lng: number;
}

/**
 * 지도 핀. `lat`·`lng` 가 **둘 다 nullable** 이라 좌표가 없는 슬롯은 건너뛰는데, 남은 핀의
 * 번호는 **다시 매기지 않는다**(01b AC-13). 카드 번호는 1..n 연속이고 핀 번호는 ①③④ 로
 * 뛴다 — 재번호하면 사용자가 지도 ② 를 누르고 카드 ② 를 기대할 때 다른 장소가 나온다.
 */
export function buildDraftPins(
  slots: ItineraryDaysItemSlotsItem[]
): DraftPin[] {
  return slots.flatMap((slot, index) =>
    typeof slot.lat === 'number' && typeof slot.lng === 'number'
      ? [{ number: index + 1, lat: slot.lat, lng: slot.lng }]
      : []
  );
}

/**
 * 폴링을 더 돌릴 것인가. **자체 타이머 없이** 상한을 센다 — `dataUpdateCount` 는 TanStack
 * Query 가 이미 세고 있는 값이라(`refetchInterval` 함수형이 받는 `Query` 인스턴스의
 * `state`), 우리가 카운터 상태를 따로 만들 이유가 없다.
 *
 * 첫 응답 전에도 이 판정이 불린다(그때 `generationState` 는 `undefined`) — 아직 채워지는
 * 중임이 확인된 `PARTIAL` 일 때만 true 다. `COMPLETE` 도 `FAILED` 도 종착이다(INV-4).
 */
export function shouldKeepPollingDraft(input: {
  generationState?: ItineraryGenerationState;
  dataUpdateCount: number;
}): boolean {
  return (
    input.generationState === 'PARTIAL' &&
    input.dataUpdateCount < DRAFT_POLL_MAX_COUNT
  );
}

export type DraftView =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'empty' }
  /** 만들기는 했는데 넣을 후보가 없었다(h35). 조건 목록은 서버 문자열 그대로 실려 나간다. */
  | { kind: 'zero'; shortfallCategories: string[] }
  | { kind: 'listed'; days: ItineraryDaysItem[]; staleFailed: boolean };

/**
 * 안내를 **켜지 않을** 값의 목록이다. 반대로(켤 값의 목록으로) 짜면 서버가 어휘를 하나
 * 늘리는 순간 화면이 조용해진다 — `level` 은 계약상 열거가 아니라 그냥 문자열이고 AI 어휘가
 * 그대로 흘러나온다(openapi 원문). 모르는 값이 자동으로 시끄러운 쪽에 떨어져야 한다(INV-4).
 */
const QUIET_CANDIDATE_LEVELS = ['OK', 'HIGH'];

/**
 * 후보 강등 안내를 켤 것인가. 대소문자·앞뒤 공백은 같은 값으로 본다(01b D3).
 *
 * 요약이 **객체로 도착했을 때만** 판정한다(D4) — `undefined`(키 자체가 없음)와 `null`(AI 가
 * 판정을 안 줬음)은 둘 다 "모른다"이지 "강등"이 아니다. 3상태라 `=== null` 만 보면 하나가 샌다.
 */
export function isCandidatesDemoted(
  summary: ItineraryCandidatesSummary | undefined
): boolean {
  if (summary === undefined || summary === null) return false;
  return !QUIET_CANDIDATE_LEVELS.includes(summary.level.trim().toUpperCase());
}

/**
 * 폴백·강등 안내 한 줄의 종류. 셋 중 **하나만** 뜬다 — 신호가 겹쳐도 심각도 최상위 하나로 접는다.
 */
export type FallbackNotice =
  { kind: 'minimal' } | { kind: 'deterministic' } | { kind: 'demoted' };

/**
 * 세 신호(`solveMode`·`isFallback`·후보 요약)를 배너 하나로 접는다. 화면은 이 결과만 받고
 * 원천 신호도 그 어휘도 모른다(판정이 두 층에 흩어지면 같은 규칙이 서로 다르게 진화한다).
 *
 * 심각도 순위 **MINIMAL > LOW(demoted) > DETERMINISTIC** — 실제 후보 누락(LOW)이 알고리즘
 * 강등(DETERMINISTIC)보다 심각하다(01b). 그래서 `minimal → demoted → deterministic` 순으로
 * 검사해 첫 매치를 반환하고, 아무 신호도 없으면 `null`(배너 0건)이다.
 *
 * `minimal` 갈래만 `isFallback` 을 함께 본다 — MANUAL(직접 만들기)은 `solveMode=MINIMAL` 이지만
 * 실패가 아니라 선택이라 `isFallback=false` 다. 이 게이트가 없으면 빈 일정에 오배너가 뜬다.
 * 그 게이트가 `demoted` 까지 삼키면 정당한 강등을 놓치므로, LOW 판정은 `isFallback` 과 무관하게 산다.
 */
export function resolveFallbackNotice(input: {
  solveMode?: ItinerarySolveMode;
  isFallback?: boolean;
  candidatesSummary?: ItineraryCandidatesSummary;
}): FallbackNotice | null {
  if (input.solveMode === 'MINIMAL' && input.isFallback === true) {
    return { kind: 'minimal' };
  }
  if (isCandidatesDemoted(input.candidatesSummary)) {
    return { kind: 'demoted' };
  }
  if (input.isFallback === true && input.solveMode === 'DETERMINISTIC') {
    return { kind: 'deterministic' };
  }
  return null;
}

/**
 * 얼굴 판정 — **손에 든 슬롯을 가장 먼저 본다.** 2차 생성이 죽어도 1차분은 유효하므로
 * (openapi: `FAILED` = 2차 실패, 1차분은 유효) 실패가 목록을 덮지 않고 `staleFailed` 라는
 * 별도 축으로 같은 값 안에 실려 나간다. 목록도 살고 실패도 삼켜지지 않는다(INV-4).
 *
 * 세는 단위가 **일자가 아니라 슬롯**인 것이 후보 0건(h35)의 급소다 — 서버는 빈 일자를 담아
 * 보낼 수 있고, `days.length` 로만 보면 그 응답이 목록으로 새어 h35 가 영영 안 뜬다. 반대로
 * 일부 날짜만 비었으면 합계가 0이 아니므로 목록이 그대로 유지된다(01b D5·D6).
 *
 * 0건 판정에 `level`·`poolSize` 어휘를 쓰지 않는 것도 같은 이유다 — 어휘가 얼굴을 정하면
 * 서버가 말을 바꾸는 날 화면이 통째로 달라진다. 요약이 **객체로 도착했다**는 사실만 쓴다.
 *
 * 겹치는 조합의 순서(슬롯 > loading > failed > zero > empty)는 AC 가 정하지 않은 축이라
 * 이 사이클의 구현 판단이다 — 근거는 03 리포트. `failed > zero` 만 심판이 잠갔다.
 */
export function resolveDraftView(input: {
  days: ItineraryDaysItem[];
  loading: boolean;
  failed: boolean;
  candidatesSummary?: ItineraryCandidatesSummary;
}): DraftView {
  const slotCount = input.days.reduce((sum, day) => sum + day.slots.length, 0);
  if (slotCount > 0) {
    return { kind: 'listed', days: input.days, staleFailed: input.failed };
  }
  if (input.loading) return { kind: 'loading' };
  if (input.failed) return { kind: 'failed' };

  const summary = input.candidatesSummary;
  if (summary !== undefined && summary !== null) {
    // 키가 없는 것과 빈 배열을 여기서 하나로 만든다 — 화면이 "없음"과 "빈 배열"을 각각
    // 다루면 같은 규칙이 두 층에 흩어진다(01b D8).
    return {
      kind: 'zero',
      shortfallCategories: summary.shortfallCategories ?? [],
    };
  }

  return { kind: 'empty' };
}
