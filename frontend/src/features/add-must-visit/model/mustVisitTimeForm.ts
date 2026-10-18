import type { AddMustVisitRequest } from '@/shared/api/index.schemas';

/**
 * h07 방문 시각 지정의 순수 판정 — 날짜 칩 · 시각 휠 열 · 휠 위치 · FIXED 폼 검증 · 요청 본문.
 *
 * 고를 수 있는 날짜를 여행 기간으로만 만들어 INV-U1-17(`fixedDate` 는 여행 기간 안)을 사후
 * 검증이 아니라 **입력 위젯 자체로** 강제한다. 시계는 읽지 않는다 — 요일은 `Date.UTC` 산술이다.
 */

export type DwellKey = 'SHORT' | 'NORMAL' | 'LONG';

export interface MustVisitTimeForm {
  /** 시각 고정 토글(BR-U1-48). 꺼져 있으면 고정할 값이 없다. */
  fixed: boolean;
  fixedDate: string | null;
  /** 'HH:mm' */
  fixedStart: string | null;
  dwellKey: DwellKey;
}

/** ⚠️ 세 숫자는 정본 공백을 메운 구현 결정이다(01b D4) — `domain-entities.md` 는 필드만,
 * `frontend-components.md` §8 은 "범위 안내만" 이라고 한다. 값을 바꿀 곳은 여기 한 군데다. */
const DWELL_MINUTES: Record<DwellKey, number> = {
  SHORT: 30,
  NORMAL: 60,
  LONG: 120,
};

export const DWELL_OPTIONS: {
  key: DwellKey;
  label: string;
  dwellMin: number;
}[] = [
  { key: 'SHORT', label: '짧게', dwellMin: DWELL_MINUTES.SHORT },
  { key: 'NORMAL', label: '보통', dwellMin: DWELL_MINUTES.NORMAL },
  { key: 'LONG', label: '여유', dwellMin: DWELL_MINUTES.LONG },
];

/** Figma 가 `보통` 을 선택된 상태로 그린다 → 미선택 갈래가 없다. */
export const DEFAULT_DWELL_KEY: DwellKey = 'NORMAL';

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' 의 다음 날. `Date.UTC` 는 지금을 읽지 않는 순수 산술이라 달 길이·윤년을 대신
 * 세어 준다(`baseGate.nextDate` 가 문자열로 하던 일과 같은 결과). */
function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

/** `6.11 (목)` — 구분자는 점, 요일은 계산값이다. ⚠️ Figma 목업의 요일(`6.10 (화)`)은 실제
 * 달력과 어긋난다(2026-06-10 은 수요일) — 목업을 베끼지 않는다. */
function dayChipLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday =
    WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}.${day} (${weekday})`;
}

/** 여행 기간의 모든 날. 기간이 비었거나 뒤집혔으면 빈 목록이다 — 배선이 빈 문자열을 넘기는
 * 경로가 실재해서, 안 막으면 루프가 안 끝난다(`tripDayOptions` 선례). */
export function tripDayChips(period: {
  startDate: string;
  endDate: string;
}): { date: string; label: string }[] {
  if (period.startDate === '' || period.endDate === '') return [];
  const chips: { date: string; label: string }[] = [];
  let date = period.startDate;
  while (date <= period.endDate) {
    chips.push({ date, label: dayChipLabel(date) });
    date = nextDate(date);
  }
  return chips;
}

/** 시작 시각 휠의 두 열 — 시 00~23 · 분 00~59(1분 간격, TRIP-1437). 시+분을 이으면 `HH:mm` 이고
 * `AddMustVisitRequest.fixedStart` 형식이 `HH:mm[:ss]` 다. */
export function startTimeOptions(): { hours: string[]; minutes: string[] } {
  const pad2 = (n: number): string => String(n).padStart(2, '0');
  return {
    hours: Array.from({ length: 24 }, (_, hour) => pad2(hour)),
    minutes: Array.from({ length: 60 }, (_, minute) => pad2(minute)),
  };
}

/** 서버 기본 창(일과 값이 null 일 때)의 시작 — 정본 `Trip.dayStartAt` 설명. */
const DEFAULT_DAY_START = '09:00';

/**
 * TRIP-1437 · Q-066 — 시작 시각을 아직 안 골랐을 때 휠을 **세울 자리**('HH:mm'). 값이 아니라 위치다
 * (BR-U1-49 — 폼에 넣지 않는다). 고른 날짜가 여행 첫날이면 첫날 시작, 아니면(날짜 미선택 포함) 하루 시작,
 * 둘 다 없으면 09:00. 서버 값은 `HH:mm[:ss]` 라 앞 5글자만 쓴다.
 */
export function startWheelAnchor(input: {
  fixedDate: string | null;
  startDate: string | undefined;
  dayStartAt?: string | null;
  firstDayStartAt?: string | null;
}): string {
  const { fixedDate, startDate, dayStartAt, firstDayStartAt } = input;
  const dayStart =
    fixedDate === startDate ? (firstDayStartAt ?? dayStartAt) : dayStartAt;
  return (dayStart ?? DEFAULT_DAY_START).slice(0, 5);
}

type CompleteFixedForm = MustVisitTimeForm & {
  fixedDate: string;
  fixedStart: string;
};

/** 저장 게이트의 유일한 정의 — 아래 두 공개 함수가 이것 하나를 나눠 쓴다. */
function isCompleteFixedForm(
  form: MustVisitTimeForm
): form is CompleteFixedForm {
  return form.fixed && form.fixedDate !== null && form.fixedStart !== null;
}

/** 저장이 막힌 사유. 사유 슬롯이 하나뿐이라 우선순위가 계약이다 — 날짜를 먼저 말한다. */
export function mustVisitTimeBlockReason(
  form: MustVisitTimeForm
): 'DATE_MISSING' | 'START_MISSING' | undefined {
  if (!form.fixed) return undefined;
  if (form.fixedDate === null) return 'DATE_MISSING';
  if (form.fixedStart === null) return 'START_MISSING';
  return undefined;
}

/** OFF(토글 꺼짐)는 ANYTIME 이라 값 없이도 저장 가능하다(BR-U1-48 — 시각을 안 정하는 선택).
 * 토글을 켠 FIXED 갈래만 날짜·시각 완성을 요구한다. */
export function canSubmitMustVisitTime(form: MustVisitTimeForm): boolean {
  return !form.fixed || isCompleteFixedForm(form);
}

/** 만들 수 없는 요청은 나갈 수도 없다 — 되돌릴 수 없는 DELETE 를 검증 전에 보내지 않는 것이
 * 이 `null` 의 실질이다(01b D1 의 위험). */
export function buildFixedMustVisitRequest(input: {
  poiId: string;
  form: MustVisitTimeForm;
}): AddMustVisitRequest | null {
  const { poiId, form } = input;
  if (!isCompleteFixedForm(form)) return null;
  return {
    poiId,
    type: 'FIXED',
    fixedDate: form.fixedDate,
    fixedStart: form.fixedStart,
    dwellMin: DWELL_MINUTES[form.dwellKey],
  };
}

/** ANYTIME 은 시각을 안 정하는 선택이라 요청도 **최소본**이다 — 날짜·시각·체류를 싣지 않는다
 * (AI 가 영업시간·동선으로 자동 배치, BR-U1-48). 여분 키를 넣으면 그게 곧 솔버 힌트가 된다. */
export function buildAnytimeMustVisitRequest(input: {
  poiId: string;
}): AddMustVisitRequest {
  return { poiId: input.poiId, type: 'ANYTIME' };
}
