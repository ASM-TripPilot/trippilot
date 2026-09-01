import type { Trip } from '@/shared/api/generated/schemas';
import { buildMonthGrid, isDateInRange } from '@/shared/date/monthGrid';

/**
 * TRIP-575 · j07 여행 캘린더 도메인 순수 함수. `useGetTrips()`가 준 `Trip[]`을 화면 재료로 접는다:
 *  1) 그 달에 마킹할 날 집합(복수 여행 모두, BR-U5-49),
 *  2) 지난 여행 카드 목록(status ENDED 또는 endDate<오늘, endDate 최신순, US-REC-14),
 *  3) 카드 라벨(날짜범위 + 박수).
 * 시계·네트워크·화면을 모른다 — 오늘 날짜는 문자열로 주입받는다. 월 그리드 수학은 재구현하지 않고
 * `@/shared/date`(monthGrid)를 경유한다(맹점② — stay/trip 두 벌 직접 import 금지, 세 벌째 금지).
 *
 * ★[[반쪽 방어]](571~574·570 계보): trips=null·원소 null·startDate/endDate null·빈 배열에도 던지지
 * 않는다. 결측 dates 는 `isDateInRange`가 false 로 접어 마킹에서 배제되고, 라벨은 null 로 정직 degrade
 * (가짜 "0박"·가짜 날짜 금지).
 */

const MS_PER_DAY = 86_400_000;
/** 카드 라벨 구분자 — en dash(U+2013, 리포 `baseScreen`·`baseSections` 관례). */
const DASH = '–';

export interface PastTripCardVM {
  tripId: string;
  title: string;
  dateRangeLabel: string | null;
  nightsLabel: string | null;
}

function epochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

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
 * 카드 날짜범위 라벨. 같은 달/같은 해는 뒤쪽 연(·월)을 접고, 다른 해면 양쪽 다 표기한다.
 *  같은 달  '2026.5.1–5.3' · 같은 해 '2026.5.30–6.2' · 다른 해 '2026.12.30–2027.1.2'.
 * 한쪽이라도 null 이면 못 만들어 null(가짜 날짜 금지).
 */
export function formatTripDateRange(
  start: string | null,
  end: string | null
): string | null {
  if (start === null || end === null) return null;
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const head = `${sy}.${sm}.${sd}`;
  if (sy !== ey) return `${head}${DASH}${ey}.${em}.${ed}`;
  return `${head}${DASH}${em}.${ed}`;
}

/** 'N박 M일' 라벨. nights<=0(같은날·역전)이거나 null 이면 null(가짜 "0박" 금지). */
export function nightsLabel(
  start: string | null,
  end: string | null
): string | null {
  if (start === null || end === null) return null;
  const nights = epochDay(end) - epochDay(start);
  if (nights <= 0) return null;
  return `${nights}박 ${nights + 1}일`;
}
