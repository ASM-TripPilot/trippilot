import type { HomePhase } from './homeTypes';

/**
 * TRIP-371 · 홈 실데이터 배선의 순수 판정 계층(화면 아님, 네트워크·시계 read 0).
 * `today` 는 인자로 주입받아 결정론적이다 — 시계를 직접 읽지 않는다(CI 타임존 무관).
 *
 * ★ 경계(02a §4-★1·★2): `features/home` 은 eslint zone·homeStructure D-1 대상이라 서버
 * 스키마(Trip 타입)나 타 feature(trip·itinerary) 를 import 할 수 없다 — 리터럴 금칙이라 이
 * 주석도 그 경로 문자열을 적으면 스캔에 걸린다(그래서 여기 안 적는다).
 *  - Trip 대신 **로컬 구조 타입** `HomeTripInput`(라우트가 넘기는 서버 목록이 구조적으로 대입됨).
 *  - meta 조립 포맷터는 라우트(app 층)가 `formatTripMeta` 로 **주입**한다 — 이 파일은 경계 안에 순수하게 남는다.
 */

/** resolveHomePhase 가 지배 여행 판정에 쓰는 최소 필드(Trip 의 구조적 부분집합). */
export interface HomeTripInput {
  /** 서버 Trip.tripId 스루 — 지배 여행 식별자(TRIP-401, 스키마 미참조 로컬 필드). */
  tripId: string;
  title: string;
  /** 'YYYY-MM-DD' */
  startDate: string;
  /** 'YYYY-MM-DD' */
  endDate: string;
  party: number;
  /** TripStatus 리터럴('PLANNED'|'CONFIRMED'|'ACTIVE'|'ENDED') — 서버 스키마 미참조를 위해 string 으로 넓힘 */
  status: string;
}

export interface ResolveHomePhaseInput {
  trips: HomeTripInput[];
  /** 'YYYY-MM-DD' — 기준일 주입(결정론, 시계 안 읽음) */
  today: string;
  savedCount: number;
  /** 라우트가 formatTripRange+formatNightsLabel+party 로 조립해 주입(경계 우회) */
  formatTripMeta: (trip: HomeTripInput) => string;
}

const MS_PER_DAY = 86_400_000;

/**
 * 'YYYY-MM-DD' → UTC epoch day(자정 기준 일수). 형식이 아니면 NaN.
 * UTC 산술이라 CI 타임존(UTC-x)에서도 하루가 안 밀린다(planState.utcDayTime 과 같은 규율).
 */
function toEpochDay(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return NaN;
  const [, year, month, day] = match;
  return Math.floor(
    Date.UTC(Number(year), Number(month) - 1, Number(day)) / MS_PER_DAY
  );
}

/**
 * 여행 시작일(startDate) 대비 오늘(today)로 D-day 문자열을 만든다.
 *  - 미래  → 'D-21' / 'D-3'
 *  - 당일  → 'D-DAY'
 *  - 과거  → 'D+3'
 * 형식이 'YYYY-MM-DD' 가 아니면 빈 문자열(planState.formatNightsLabel 페일 관례).
 */
export function formatDday(startDate: string, today: string): string {
  const start = toEpochDay(startDate);
  const now = toEpochDay(today);
  if (Number.isNaN(start) || Number.isNaN(now)) return '';

  const diff = start - now;
  if (diff > 0) return `D-${diff}`;
  if (diff === 0) return 'D-DAY';
  return `D+${-diff}`;
}

/**
 * 오늘이 [startDate, endDate] 안이면 여행 중. formatDday 와 같은 UTC epoch-day 산술이라
 * badge 와 dday 가 한 소스를 공유한다(TRIP-472 · 모순 조합 제거). 형식 이상이면 false(계획 중).
 */
function isTraveling(
  startDate: string,
  endDate: string,
  today: string
): boolean {
  const start = toEpochDay(startDate);
  const end = toEpochDay(endDate);
  const now = toEpochDay(today);
  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(now)) {
    return false;
  }
  return start <= now && now <= end;
}

/**
 * status → 홈 카드 CTA 문구(TRIP-472). 목적지는 라우트가 resolveItineraryDestination 으로
 * 정하고 여기선 문구만 맞춘다 — CONFIRMED/ACTIVE 도 "일정 이어서 짜기"로 보이던 결함 해소.
 * 카피 정본 미명시라 h25/h34(완성·확정 일정 보기) 취지로 채운다.
 */
function ctaLabelForStatus(status: string): string {
  if (status === 'CONFIRMED') return '확정 일정 보기';
  if (status === 'ACTIVE') return '여행 일정 보기';
  return '일정 이어서 짜기';
}

/**
 * 지배 여행(가장 이른 startDate 의 비-ENDED)을 골라 planning 얼굴을 조립한다.
 * 비-ENDED 여행이 없으면(빈 목록·전부 ENDED) undefined — 라우트가 phase 미전달로 discovery.
 *
 * startDate 는 'YYYY-MM-DD' 라 문자열 사전순 비교가 곧 연대순이다(별도 파싱 불필요).
 * badge 는 오늘이 [startDate, endDate] 안이면 '여행 중', 아니면 '계획 중'(TRIP-472). dday 와
 * 같은 날짜 소스라 "여행 중"+"D-1" 같은 모순이 안 나온다(구 01b Q2 의 server-status 기준을 폐기).
 * ctaLabel 은 status 로 분기한다(TRIP-472) — 확정/여행중 일정도 계속 "일정 이어서 짜기"로 보이던
 * 결함 해소. 탭 목적지 자체는 라우트(resolveItineraryDestination)가 지므로 여기선 문구만 맞춘다.
 * meta 는 이 파일이 만들지 않고 주입받은 formatTripMeta 로 조립한다(경계 우회, §4-★1).
 * greetTitle·bridge 카피는 정본 미명시라 fixture PLANNING 값 기준으로 채운다(savedCount 는 실카운트).
 */
export function resolveHomePhase(
  input: ResolveHomePhaseInput
): HomePhase | undefined {
  const { trips, today, savedCount, formatTripMeta } = input;

  const active = trips.filter((trip) => trip.status !== 'ENDED');
  if (active.length === 0) return undefined;

  const dominant = active.reduce((earliest, trip) =>
    trip.startDate < earliest.startDate ? trip : earliest
  );
  const dday = formatDday(dominant.startDate, today);

  return {
    kind: 'planning',
    greetTitle: `${dominant.title} ${dday}`,
    dominantTripId: dominant.tripId,
    trip: {
      badge: isTraveling(dominant.startDate, dominant.endDate, today)
        ? '여행 중'
        : '계획 중',
      dday,
      ctaLabel: ctaLabelForStatus(dominant.status),
      title: dominant.title,
      meta: formatTripMeta(dominant),
    },
    bridge: {
      title: `담은 곳 ${savedCount}곳이 아직 일정에 없어요`,
      subtitle: '남은 자리에 넣어볼까요',
      ctaLabel: '일정에 추가',
    },
  };
}
