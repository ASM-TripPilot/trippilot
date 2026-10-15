import type { SummaryLine } from './tripSummary';

/**
 * 일과 창(TRIP-1308) — 여행 생성·수정 요청의 `dayStartAt`·`firstDayStartAt`·`lastDayEndAt` 세 값.
 * 전부 선택 입력이고 시각은 `HH:mm`(24시간)이다. **안 정한 값은 키 자체가 없다** — 빈 문자열·`00:00`
 * 으로 채우면 서버가 "미설정"과 구분하지 못한다. 시각 소요(분·시간) 표기는 없다(INV-3).
 */
export interface DayWindow {
  /** 하루 일과 시작(전 일자 공통). */
  dayStartAt?: string;
  /** 첫날만 다른 시작(비행기·KTX 도착 뒤). */
  firstDayStartAt?: string;
  /** 마지막 날만 다른 종료(출발·귀가 전). */
  lastDayEndAt?: string;
}

/** 서버 기본 창 — 안 보내면 서버가 쓰는 값(openapi). 화면 표시·검증의 기준이다. */
export const DEFAULT_DAY_START = '09:00';
export const DEFAULT_DAY_END = '21:00';
/** 첫날·마지막 날을 "정함"으로 켤 때의 시작값(제안값 — 하루 시작보다 이르거나 늦으면 검증이 막으니 가운데쯤). */
export const DEFAULT_FIRST_DAY_START = '12:00';
export const DEFAULT_LAST_DAY_END = '18:00';

/** 휠 눈금 — 시 24칸, 분은 30분 단위(제안). */
export const WHEEL_HOURS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, '0')
);
export const WHEEL_MINUTES = ['00', '30'];

export type DayWindowViolation = 'END_NOT_AFTER_START' | 'DAY_START_AFTER_END';

/** 기본값과 같은 하루 시작을 지운다 — 기본이면 요청에 안 실린다. 정한 값만 키가 남는다. */
export function normalizeDayWindow(window: DayWindow): DayWindow {
  return {
    ...(window.dayStartAt !== undefined &&
    window.dayStartAt !== DEFAULT_DAY_START
      ? { dayStartAt: window.dayStartAt }
      : {}),
    ...(window.firstDayStartAt !== undefined
      ? { firstDayStartAt: window.firstDayStartAt }
      : {}),
    ...(window.lastDayEndAt !== undefined
      ? { lastDayEndAt: window.lastDayEndAt }
      : {}),
  };
}

/** 모두 기본(= 요청에 아무것도 안 실림)인가. */
export function isDefaultDayWindow(window: DayWindow): boolean {
  return Object.keys(normalizeDayWindow(window)).length === 0;
}

/** 요청 본문에 얹을 조각 — 정한 값만 키가 있다(`undefined` 값 키도 만들지 않는다). */
export function dayWindowFields(window: DayWindow): DayWindow {
  return normalizeDayWindow(window);
}

/**
 * 입력 단계 검증 — 서버가 400 으로 거절할 값을 미리 막는다. 'HH:mm' 은 사전순 비교가 곧 시간순이다.
 *  - 당일치기(`sameDay`): 첫날=마지막 날이라 실효 시작 < 실효 종료여야 한다.
 *  - 그 외: 하루 시작(·첫날 시작)이 일과 종료(기본 21:00)보다 이르고, 마지막 날 종료가 있으면 그보다도 이르다.
 */
export function validateDayWindow(
  window: DayWindow,
  sameDay: boolean
): DayWindowViolation[] {
  const dayStart = window.dayStartAt ?? DEFAULT_DAY_START;
  if (sameDay) {
    const start = window.firstDayStartAt ?? dayStart;
    const end = window.lastDayEndAt ?? DEFAULT_DAY_END;
    return start < end ? [] : ['END_NOT_AFTER_START'];
  }
  const starts = [dayStart, window.firstDayStartAt ?? dayStart];
  const lastEnd = window.lastDayEndAt ?? DEFAULT_DAY_END;
  const broken =
    starts.some((start) => start >= DEFAULT_DAY_END) || dayStart >= lastEnd;
  return broken ? ['DAY_START_AFTER_END'] : [];
}

/**
 * g01 "일과 시간" 행 — 기본이면 `09:00 시작` + `기본`, 바꾸면 설정한 것만 보조로 단다(24시간제).
 * `invalid` 면 보조 자리에 확인 안내를 건다(시간을 만진 뒤 여행 기간을 줄여 창이 깨진 경우 —
 * [다음]만 조용히 막히지 않게).
 */
export function summaryDayWindow(
  window: DayWindow,
  sameDay: boolean,
  invalid = false
): SummaryLine {
  const normalized = normalizeDayWindow(window);
  const start =
    (sameDay ? normalized.firstDayStartAt : undefined) ??
    normalized.dayStartAt ??
    DEFAULT_DAY_START;
  const main = `${start} 시작`;
  if (invalid) return { main, sub: '시작·종료 시각을 확인해 주세요' };
  if (isDefaultDayWindow(window)) return { main, sub: '기본' };
  const parts = sameDay
    ? [
        normalized.lastDayEndAt !== undefined
          ? `${normalized.lastDayEndAt}까지`
          : undefined,
      ]
    : [
        normalized.firstDayStartAt !== undefined
          ? `첫날 ${normalized.firstDayStartAt}부터`
          : undefined,
        normalized.lastDayEndAt !== undefined
          ? `마지막 날 ${normalized.lastDayEndAt}까지`
          : undefined,
      ];
  const sub = parts.filter((part) => part !== undefined).join(' · ');
  return sub === '' ? { main } : { main, sub };
}
