import type { CompanionType } from '@/shared/api/generated/schemas';

/**
 * 위저드 1/2 화면이 쓰는 순수 함수 — 기간 프리셋 → 날짜 범위 계산, 날짜 표시 포맷,
 * 프리셋·동반 유형 코드표(TRIP-205). 화면·스토어·서버를 모른다.
 *
 * ⚠️ 시계를 읽지 않는다 — 기준일은 전부 인자로 받는다(01b D5). `new Date(`·`Date.now(`을
 * 이 파일에 쓰면 `tripWizardStep1Boundary.test.ts`(AC-5)가 red를 낸다.
 *
 * 프리셋 계산 규칙 자체는 정본에 없다(BR-U1-36은 "자동 채우되 수정 가능"만 말한다) — 아래
 * 규칙은 이 칸이 정한 것이고, 게이트①에서 뒤집히면 이 파일의 계산만 바꾸면 된다(02a §2.3).
 */

export type PeriodPresetCode =
  'this-weekend' | 'next-weekend' | '1n2d' | '3n4d';
export type CompanionCode = 'alone' | 'friend' | 'partner' | 'family';

/** 코드는 testID용 ASCII(01b D7), 라벨은 화면에 보이는 한글(BR-U1-36). */
export const PERIOD_PRESETS: readonly {
  code: PeriodPresetCode;
  label: string;
}[] = [
  { code: 'this-weekend', label: '이번 주말' },
  { code: 'next-weekend', label: '다음 주말' },
  { code: '1n2d', label: '1박 2일' },
  { code: '3n4d', label: '3박 4일' },
];

/** 코드는 testID용 ASCII, `type`은 서버가 받는 enum 한글(BR-U1-39 · 01b D7). */
export const COMPANION_OPTIONS: readonly {
  code: CompanionCode;
  type: CompanionType;
}[] = [
  { code: 'alone', type: '혼자' },
  { code: 'friend', type: '친구' },
  { code: 'partner', type: '연인' },
  { code: 'family', type: '가족' },
];

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' → 에포크 일수(UTC 기준). `tripDraft.ts`의 동명 함수와 계산식은 같지만
 * (`Date.UTC` 기준, 로컬 타임존 무관) 그 함수를 가져다 쓰지 않는다 — export되지 않은
 * private 함수라 가져올 수 없고, 이 계산은 tripDraft 고유의 판정 로직이 아니라 날짜 산술의
 * 표준 규칙일 뿐이라 이 파일이 따로 갖는 것이 더 단순하다. */
function toEpochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/**
 * 에포크 일수 → { year, month, day }. `new Date(ms)` 생성자를 거치지 않는 순수 정수 계산
 * (Howard Hinnant의 civil_from_days, 그레고리력 변환 표준 알고리즘)이다 — 이 파일 전체가
 * 시계를 읽지 않아야 한다는 제약(01b D5) 때문에 `new Date(...)`를 아예 쓰지 않는다.
 */
function epochDayToDate(epochDay: number): {
  year: number;
  month: number;
  day: number;
} {
  const z = epochDay + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  const year = month <= 2 ? y + 1 : y;
  return { year, month, day };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function fromEpochDay(epochDay: number): string {
  const { year, month, day } = epochDayToDate(epochDay);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 기준일 에포크의 요일(0=일요일 … 6=토요일). 에포크 0(1970-01-01)이 목요일이라는 사실
 * 하나로 `new Date().getDay()` 없이 요일을 얻는다. */
function dayOfWeek(epochDay: number): number {
  return ((epochDay % 7) + 7 + 4) % 7;
}

/** 기준일 당일부터 이번 주 토요일까지 남은 일수. 토요일 당일이면 0. */
function daysUntilSaturday(epochDay: number): number {
  return (6 - dayOfWeek(epochDay) + 7) % 7;
}

/**
 * 기간 프리셋 → 날짜 범위(02a §2.3, 이 칸이 정한 규칙 — 뒤집히면 이 함수만 바꾸면 된다).
 *  - `1n2d`(1박 2일) · `3n4d`(3박 4일): 기준일 당일 시작.
 *  - `this-weekend`(이번 주말): 기준일 포함 다음 토요일 시작, 1박(토→일). 기준일이 토요일이면
 *    당일, 일요일이면 "이번 주말이 이미 끝났다"고 보고 다음 토요일로 넘어간다.
 *  - `next-weekend`(다음 주말): `this-weekend`의 정확히 7일 뒤.
 */
export function presetRange(
  code: PeriodPresetCode,
  baseDate: string
): { startDate: string; endDate: string } {
  const base = toEpochDay(baseDate);

  if (code === '1n2d') {
    return { startDate: fromEpochDay(base), endDate: fromEpochDay(base + 1) };
  }
  if (code === '3n4d') {
    return { startDate: fromEpochDay(base), endDate: fromEpochDay(base + 3) };
  }

  const thisWeekendStart = base + daysUntilSaturday(base);
  const start =
    code === 'next-weekend' ? thisWeekendStart + 7 : thisWeekendStart;
  return { startDate: fromEpochDay(start), endDate: fromEpochDay(start + 1) };
}

/**
 * 출발일 + 박수 합 → 종료일(TRIP-389). 달력이 출발일만 고르고 종료일은 이 파생이 정한다.
 * 에포크 일수의 정수 덧셈이라 `종료일 − 출발일 === nights`가 항상 성립해 INV-U1-14(박수 합이
 * 기간을 넘을 수 없다)를 검사가 아니라 형태로 만든다 — 달력 파생 경로에서는 위반이 구조적으로
 * 불가하다. `presetRange`와 같은 `base + N` 패턴이라 `fromEpochDay`를 그대로 재사용하고,
 * `new Date(`를 안 써 월·연·윤년 경계를 넘으면서도 시계를 읽지 않는다.
 */
export function deriveEndDate(startDate: string, nights: number): string {
  return fromEpochDay(toEpochDay(startDate) + nights);
}

function formatMonthDay(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}월 ${day}일`;
}

/** '6월 10일 – 6월 13일'(en dash, U+2013 — Figma `dateF` 실측 그대로, 하이픈이 아니다).
 * 한쪽이라도 없으면 화면이 자리표시 문구를 그릴 수 있도록 `null`을 돌려준다(빈 문자열이
 * 아니다 — "미선택"과 "빈 문자열"은 다른 뜻이다). */
export function formatDateRange(
  startDate?: string,
  endDate?: string
): string | null {
  if (startDate === undefined || endDate === undefined) return null;
  return `${formatMonthDay(startDate)} – ${formatMonthDay(endDate)}`;
}
