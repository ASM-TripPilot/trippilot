/**
 * TRIP-1788 · 여행 설정 기간 편집 규칙 — 화면이 부르는 순수 함수 모음. 시계·네트워크를 모른다(오늘은 인자).
 * 날짜 덧셈은 `deriveEndDate`(에포크 일수 산술)에 맡기고, 일수 차이는 UTC 자정 뺄셈이라 월·연·윤년 경계를 넘어도 맞다.
 */
import { isAxiosError } from 'axios';

import type { Trip, TripDestination } from '@/shared/api/index.schemas';
import { deriveEndDate, MAX_TRIP_NIGHTS } from '@/features/create-trip';

const DAY_MS = 86_400_000;

function epochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** 끝 − 시작(일). 박 수와 같다(당일치기 0). */
export function nightsBetween(startDate: string, endDate: string): number {
  return epochDay(endDate) - epochDay(startDate);
}

/** 시작을 `newStart` 로 옮기면 끝은 같은 일수로 따라온다 — 박수 합이 아니라 날짜끼리 뺀 일수를 보존한다. */
export function shiftedEndDate(
  period: { startDate: string; endDate: string },
  newStart: string
): string {
  return deriveEndDate(
    newStart,
    nightsBetween(period.startDate, period.endDate)
  );
}

/**
 * 끝일 모드의 달력 탭 — 탭 ≥ 시작이면 끝이 탭(시작+30일까지), 탭 < 시작이면 시작이 탭·끝은 그대로(새 시작+30일까지).
 * 30일 초과는 무시하지 않고 잘라서 달력에 결과가 보이게 한다(`MAX_TRIP_NIGHTS`).
 */
export function pickLengthRange(
  range: { start: string; end: string },
  tapped: string
): { start: string; end: string } {
  const start = tapped >= range.start ? range.start : tapped;
  const wanted = tapped >= range.start ? tapped : range.end;
  const limit = deriveEndDate(start, MAX_TRIP_NIGHTS);
  return { start, end: wanted < limit ? wanted : limit };
}

export type PeriodLock = 'ended' | 'started' | 'generating' | null;

/** 기간을 못 바꾸는 이유 — 끝남 > 시작됨(오늘 시작 포함: 사용자 결정 "여행 중 잠금") > 생성 중 > 열림. */
export function periodLock(
  trip: Pick<Trip, 'status' | 'startDate' | 'itineraryGenerating'>,
  today: string
): PeriodLock {
  if (trip.status === 'ENDED') return 'ended';
  if (trip.startDate <= today) return 'started';
  if (trip.itineraryGenerating) return 'generating';
  return null;
}

/** 기간 행 보조문 — 잠금 이유마다 글자가 다르다. */
export function periodHint(lock: PeriodLock): string {
  switch (lock) {
    case 'started':
      return '여행이 시작돼 기간은 바꿀 수 없어요';
    case 'generating':
      return '일정을 만드는 중이에요. 끝난 뒤 바꿀 수 있어요';
    case 'ended':
      return '끝난 여행은 바꿀 수 없어요';
    case null:
      return '날짜를 옮기거나 일수를 바꿀 수 있어요';
  }
}

/** 409 응답의 `error.code` 만 꺼낸다(서버 봉투 `{error:{code}}`). 409 가 아니거나 코드를 못 읽으면 null. */
export function periodConflictCode(error: unknown): string | null {
  if (!isAxiosError(error) || error.response?.status !== 409) return null;
  const code = (error.response.data as { error?: { code?: unknown } } | null)
    ?.error?.code;
  return typeof code === 'string' ? code : null;
}

/** 그 여행의 자식 조회 키(`/trips/{id}/…`)인가 — 끝 슬래시까지 본다(단건·접두만 같은 다른 id 는 거짓). */
export function isTripChildKey(
  tripId: string,
  queryKey: readonly unknown[]
): boolean {
  const head = queryKey[0];
  return typeof head === 'string' && head.startsWith(`/trips/${tripId}/`);
}

/**
 * 일수를 이만큼 못 줄이면 그 이유 — 여행지가 둘 이상이면 곳마다 최소 1박이다(위저드 하한과 같다 · 한 곳은 당일치기까지 된다).
 * 늘리거나 그대로면 null(옛 0박 도시가 있는 여행도 일수가 안 줄면 안 막는다).
 */
export function shrinkBlockNotice(
  destinations: readonly TripDestination[],
  oldNights: number,
  newNights: number
): string | null {
  const count = destinations.length;
  if (count < 2 || newNights >= oldNights || newNights >= count) return null;
  return `여행지가 ${count}곳이라 ${count}박보다 줄일 수 없어요`;
}

/**
 * 일수가 바뀔 때 박수 합(INV-U1-14: Σ ≤ 기간)을 새 박수에 맞춘다. 늘면 마지막(seq 최대) 여행지에 차이를 더하고, 줄면 넘치는 만큼
 * **박수가 가장 많은 곳부터(동률이면 뒤 곳)** 1박씩 깎는다. 곳이 둘 이상이면 1박 아래로 안 깎고, 옛 0박 도시는 그대로 둔다 — 그래서 합이
 * 안 맞을 수 있는 입력(`shrinkBlockNotice` 가 막는 줄이기)은 화면이 먼저 막는다. 합이 이미 새 박수 이하면 줄여도 안 깎는다. 입력은 안 바꾼다.
 */
export function fitDestinationNights(
  destinations: readonly TripDestination[],
  oldNights: number,
  newNights: number
): TripDestination[] {
  const result = destinations.map((one) => ({ ...one }));
  if (result.length === 0) return result;

  if (newNights > oldNights) {
    const last = result.reduce((a, b) => (b.seq > a.seq ? b : a));
    last.nights += newNights - oldNights;
    return result;
  }
  const floor = result.length > 1 ? 1 : 0;
  let excess = result.reduce((sum, one) => sum + one.nights, 0) - newNights;
  while (excess > 0) {
    const most = result.reduce((a, b) =>
      b.nights > a.nights || (b.nights === a.nights && b.seq > a.seq) ? b : a
    );
    if (most.nights <= floor) break;
    most.nights -= 1;
    excess -= 1;
  }
  return result;
}
