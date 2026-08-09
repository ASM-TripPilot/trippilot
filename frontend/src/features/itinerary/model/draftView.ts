import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  ItineraryGenerationState,
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
  | { kind: 'listed'; days: ItineraryDaysItem[]; staleFailed: boolean };

/**
 * 얼굴 판정 — **도착한 일자를 가장 먼저 본다.** 2차 생성이 죽어도 1차분은 유효하므로
 * (openapi: `FAILED` = 2차 실패, 1차분은 유효) 실패가 목록을 덮지 않고 `staleFailed` 라는
 * 별도 축으로 같은 값 안에 실려 나간다. 목록도 살고 실패도 삼켜지지 않는다(INV-4).
 */
export function resolveDraftView(input: {
  days: ItineraryDaysItem[];
  loading: boolean;
  failed: boolean;
}): DraftView {
  if (input.days.length > 0) {
    return { kind: 'listed', days: input.days, staleFailed: input.failed };
  }
  if (input.loading) return { kind: 'loading' };
  if (input.failed) return { kind: 'failed' };
  return { kind: 'empty' };
}
