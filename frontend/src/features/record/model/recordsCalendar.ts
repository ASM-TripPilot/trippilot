import type { Trip } from '@/shared/api/generated/schemas';
import { buildMonthGrid, isDateInRange } from '@/shared/date/monthGrid';
import { formatTripDateRange } from '@/entities/trip/lib/formatTripPeriod';
import { nightsLabel } from '@/entities/trip/lib/formatNights';
import type { PastTripCardVM } from '@/entities/trip/model';

/**
 * TRIP-575 · j07 여행 캘린더 도메인 순수 함수. `useGetTrips()`가 준 `Trip[]`을 화면 재료로 접는다:
 *  1) 그 달에 마킹할 날 집합(복수 여행 모두, BR-U5-49),
 *  2) 지난 여행 카드 목록(status ENDED 또는 endDate<오늘, endDate 최신순, US-REC-14),
 *  3) 카드 라벨(날짜범위 + 박수 — TRIP-808 로 entities/trip/lib 에 바이트 이관, 여기선 위임·재수출).
 * 시계·네트워크·화면을 모른다 — 오늘 날짜는 문자열로 주입받는다. 월 그리드 수학은 재구현하지 않고
 * `@/shared/date`(monthGrid)를 경유한다(맹점② — stay/trip 두 벌 직접 import 금지, 세 벌째 금지).
 *
 * ★[[반쪽 방어]](571~574·570 계보): trips=null·원소 null·startDate/endDate null·빈 배열에도 던지지
 * 않는다. 결측 dates 는 `isDateInRange`가 false 로 접어 마킹에서 배제되고, 라벨은 null 로 정직 degrade
 * (가짜 "0박"·가짜 날짜 금지).
 */

// 이관된 카드 라벨 포맷터·뷰모델 재수출(807 formatPrice 선례) — frozen recordsCalendar.test·PastTripList 가
// 옛 경로로 계속 가져다 쓰고, buildPastTripCards 도 이 로컬 바인딩을 그대로 호출한다.
export { formatTripDateRange, nightsLabel };
export type { PastTripCardVM };

/** 안전한 배열로 접는다(null/undefined → []). */
function safeList(trips: readonly (Trip | null)[] | null | undefined): Trip[] {
  return Array.isArray(trips) ? (trips.filter((t) => t != null) as Trip[]) : [];
}

/**
 * 그 달에서 어떤 여행 기간에든 걸친 날('YYYY-MM-DD') 집합. 그리드의 in-month 셀을 오름차순으로 훑어
 * 어느 trip 이든 `isDateInRange`에 걸리면 담으므로 결과는 **정렬·유일**이다(복수 여행 모두, 중복 없음).
 */
export function markedDaysOfMonth(
  trips: readonly (Trip | null)[] | null | undefined,
  yearMonth: string
): string[] {
  const list = safeList(trips);
  const marked: string[] = [];
  for (const cell of buildMonthGrid(yearMonth)) {
    if (cell === null) continue;
    const hit = list.some((trip) =>
      isDateInRange(cell.date, trip.startDate ?? null, trip.endDate ?? null)
    );
    if (hit) marked.push(cell.date);
  }
  return marked;
}

function isPastTrip(trip: Trip, today: string): boolean {
  return (
    trip.status === 'ENDED' || (trip.endDate != null && trip.endDate < today)
  );
}

/**
 * 지난 여행(status ENDED 또는 endDate<오늘)만, endDate 내림차순(최신 먼저). 카드는 제목+기간(+박수)만 —
 * 사진·통계 필드가 Trip 계약에 없어(Q2 정직 degrade) 여기서 만들지 않는다.
 */
export function buildPastTripCards(
  trips: readonly (Trip | null)[] | null | undefined,
  today: string
): PastTripCardVM[] {
  return safeList(trips)
    .filter((trip) => isPastTrip(trip, today))
    .slice()
    .sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))
    .map((trip) => ({
      tripId: trip.tripId,
      title: trip.title,
      dateRangeLabel: formatTripDateRange(
        trip.startDate ?? null,
        trip.endDate ?? null
      ),
      nightsLabel: nightsLabel(trip.startDate ?? null, trip.endDate ?? null),
    }));
}

/**
 * TRIP-1015 C · 캘린더에서 이 여행 기록(`/trips/{id}/records`)을 열 수 있나 — 진행 중(시작 ≤ 오늘) 또는
 * 지난(ENDED) 여행만. 미래 여행은 탭을 무시한다(사용자 결정 2). 끝이 지난 여행은 시작도 지났으므로
 * `isPastTrip` 의 endDate 조건은 시작일 조건에 이미 담긴다.
 */
export function canOpenTripRecords(trip: Trip, today: string): boolean {
  return (
    trip.status === 'ENDED' ||
    (trip.startDate != null && trip.startDate <= today)
  );
}

/**
 * 마킹 날짜 탭 → 열 여행 id. 그 날짜를 포함하고 열 수 있는 여행 중 **시작일이 가장 늦은** 것(겹친 날은
 * 나중에 시작한 여행 — Seed Q3). 없으면 null(마킹 없는 날·미래 여행만 걸린 날).
 */
export function recordsTripIdForDate(
  trips: readonly (Trip | null)[] | null | undefined,
  date: string,
  today: string
): string | null {
  let picked: Trip | null = null;
  for (const trip of safeList(trips)) {
    if (!isDateInRange(date, trip.startDate ?? null, trip.endDate ?? null)) {
      continue;
    }
    if (!canOpenTripRecords(trip, today)) continue;
    if (picked === null || (trip.startDate ?? '') > (picked.startDate ?? '')) {
      picked = trip;
    }
  }
  return picked?.tripId ?? null;
}
