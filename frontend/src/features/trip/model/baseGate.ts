/**
 * g02 거점 지정 **전제 게이트**의 순수 판정(TRIP-226 · BR-U1-22 · BR-U1-26 · BR-U1-27 ·
 * INV-U1-08·09·15 · 01b D3·D6). 시계·네트워크·저장소를 하나도 안 읽는다 — **import가 0건인
 * 것이 그 계약**이고(AC-G4), 기준이 필요한 값은 전부 인자로 받는다(`baseSections.ts` 선례).
 *
 * `canSaveStayFix`를 `baseBlockReason`으로 **정의**하는 것이 이 파일의 핵심 결정이다(01b D3).
 * 저장 게이트와 차단 게이트를 각자 적으면 한 글자 차이로 갈라지고, 그때 사용자는 시트에서
 * 저장에 성공하고도 카드가 잠긴 상태를 본다 — D3가 없애려던 바로 그 증상이다.
 *
 * 날짜 비교는 에포크 변환 없이 문자열 그대로 한다 — 'YYYY-MM-DD'는 폭이 고정이라 사전식
 * 비교가 곧 날짜 비교이고 해를 넘어도 성립한다. `Date.UTC`는 달 길이를 셀 때만 쓴다(순수
 * 산술이라 시계가 아니다 — 같은 구분을 `baseSections.ts`가 이미 하고 있다).
 */

export type BaseBlockReason =
  'DATES_MISSING' | 'DATES_REVERSED' | 'COORD_UNCONFIRMED';

export interface StayGateInput {
  coordConfirmed: boolean;
  checkIn?: string | null;
  checkOut?: string | null;
}

export interface TripPeriod {
  startDate: string;
  endDate: string;
}

/** 시트가 고쳐 나가는 날짜 두 칸. 둘 다 `null`에서 시작한다. */
export interface StayDateDraft {
  checkIn: string | null;
  checkOut: string | null;
}

const MS_PER_DAY = 86_400_000;

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** 다음 날 'YYYY-MM-DD'. 달 길이는 "다음 달 1일 − 이번 달 1일"로 센다 — 윤년 규칙을 다시 적지
 * 않으려는 것이고, `Date.UTC(year, 12, 1)`은 다음 해 1월 1일로 정규화돼 12월도 같은 식으로
 * 풀린다. `new Date()`를 쓰지 않는 이유는 이 파일이 시계를 안 읽는다는 계약 때문이다. */
function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const lastDay = Math.round(
    (Date.UTC(year, month, 1) - Date.UTC(year, month - 1, 1)) / MS_PER_DAY
  );
  if (day < lastDay) return `${year}-${pad(month)}-${pad(day + 1)}`;
  if (month < 12) return `${year}-${pad(month + 1)}-01`;
  return `${year + 1}-01-01`;
}

/**
 * 지정을 막는 사유. 사유 슬롯이 하나뿐이라(01b D7) **우선순위가 계약**이다 —
 * `DATES_MISSING` > `DATES_REVERSED` > `COORD_UNCONFIRMED`. 날짜를 먼저 두는 근거는 최소
 * 놀람이다: 225가 이미 날짜 없는 숙소에 보이던 문구가 226의 진부분집합으로 남는다.
 */
export function baseBlockReason(
  stay: StayGateInput
): BaseBlockReason | undefined {
  const { checkIn, checkOut } = stay;
  if (checkIn == null || checkOut == null) return 'DATES_MISSING';
  // INV-U1-15 — 같은 날은 0박이라 숙박이 아니다.
  if (checkOut <= checkIn) return 'DATES_REVERSED';
  // 계약이 요구하는 도장은 이 필드 하나다 — `lat`/`lng` 유무는 조건이 아니다(INV-U1-08).
  if (!stay.coordConfirmed) return 'COORD_UNCONFIRMED';
  return undefined;
}

/** 보완 시트의 저장 게이트. **`baseBlockReason`으로 정의한다** — 두 판정이 갈라질 통로 자체를
 * 없애는 것이 01b D3의 "원리적으로"다. */
export function canSaveStayFix(draft: StayGateInput): boolean {
  return baseBlockReason(draft) === undefined;
}

/**
 * 여행 기간 **밖임을 아는가**. 이름이 판정 방향을 들고 있다 — 모르면서 "밖이다"라고 말하는
 * 것은 페일클로즈가 아니라 거짓말이라, 날짜가 없거나 여행 기간이 비면 주장하지 않는다.
 * 빈 문자열 갈래는 실재한다: 배선이 위저드 스토어의 `startDate ?? ''`를 그대로 넘긴다.
 * 경계는 등호를 포함한다(01b D6) — 마지막 날 아침 체크아웃이 실무 상식이다.
 */
export function isOutsideTripPeriod(
  stay: StayGateInput,
  period: TripPeriod
): boolean {
  const { checkIn, checkOut } = stay;
  if (checkIn == null || checkOut == null) return false;
  if (period.startDate === '' || period.endDate === '') return false;
  return checkIn < period.startDate || checkOut > period.endDate;
}

/** 이 숙소를 담으려면 여행 기간이 어디까지 늘어야 하는가. 이미 안이면 `null` — 정상 배정에
 * `PATCH /trips`가 따라붙지 않게 하는 자리다. 앞·뒤 어느 쪽으로도 늘어난다. */
export function extendedTripPeriod(
  stay: StayGateInput,
  period: TripPeriod
): TripPeriod | null {
  if (!isOutsideTripPeriod(stay, period)) return null;
  const { checkIn, checkOut } = stay;
  // 위 판정이 이미 걸렀지만 컴파일러는 두 함수의 관계를 모른다 — 타입 좁히기용이다.
  if (checkIn == null || checkOut == null) return null;
  return {
    startDate: checkIn < period.startDate ? checkIn : period.startDate,
    endDate: checkOut > period.endDate ? checkOut : period.endDate,
  };
}

/** 시트가 그릴 날짜 칩 — 여행 기간의 모든 날(체크아웃 날 포함). 기간이 비었거나 뒤집혔으면
 * 빈 목록이다: 배선이 빈 문자열을 넘기는 경로가 실재해서, 안 막으면 루프가 안 끝난다. */
export function tripDayOptions(
  period: TripPeriod
): { date: string; label: string }[] {
  if (period.startDate === '' || period.endDate === '') return [];
  const options: { date: string; label: string }[] = [];
  let date = period.startDate;
  while (date <= period.endDate) {
    const [, month, day] = date.split('-').map(Number);
    options.push({ date, label: `${month}/${day}` });
    date = nextDate(date);
  }
  return options;
}

/**
 * 날짜 칩 탭탭 프로토콜 — ① 빈 상태면 체크인 ② 한쪽만 차 있으면 체크아웃 ③ 둘 다 차 있으면
 * 새 범위를 시작한다. **앞뒤를 바꾸지 않는다.** 정렬하면 `checkOut <= checkIn` 상태에 도달할
 * 수 없어져, 그 상태를 재는 저장 게이트 케이스가 통째로 공허해진다.
 */
export function applyDayPick(
  current: StayDateDraft,
  date: string
): StayDateDraft {
  if (current.checkIn === null || current.checkOut !== null) {
    return { checkIn: date, checkOut: null };
  }
  return { checkIn: current.checkIn, checkOut: date };
}
