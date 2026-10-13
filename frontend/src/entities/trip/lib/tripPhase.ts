import { isDateInRange } from '@/shared/lib/monthGrid';

import type { ItineraryStatus, Trip } from '../model';

/**
 * TRIP-1121 · 여행 단계 — 서버 `Trip.status`(날짜만 봄, 일정 없는 초안도 ACTIVE)가 아니라
 * **일정 확정 × 오늘(서울)** 로 가른다(01b D1). h06 정렬·배지, l03 집계(1123), j07 카드(1120)가 공유한다.
 * 오늘은 호출부가 `seoulDate(new Date())` 로 넘긴다 — 이 함수는 시계를 읽지 않는다.
 */
export type TripPhase = 'draft' | 'upcoming' | 'ongoing' | 'ended';

/** 확정 아님(404 = undefined 포함) → 'draft'(날짜 안 봄) · 오늘<시작 → 'upcoming' · 오늘>종료 → 'ended' · 그 외 'ongoing'. */
export function classifyTripPhase(
  period: Pick<Trip, 'startDate' | 'endDate'>,
  itineraryStatus: ItineraryStatus | undefined,
  today: string
): TripPhase {
  if (itineraryStatus !== 'CONFIRMED') return 'draft';
  if (isDateInRange(today, period.startDate, period.endDate)) return 'ongoing';
  return today < period.startDate ? 'upcoming' : 'ended';
}

export function isTripOngoing(
  period: Pick<Trip, 'startDate' | 'endDate'>,
  itineraryStatus: ItineraryStatus | undefined,
  today: string
): boolean {
  return classifyTripPhase(period, itineraryStatus, today) === 'ongoing';
}
