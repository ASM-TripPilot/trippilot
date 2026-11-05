import type { Trip } from '@/shared/api/index.schemas';
import { isTripOngoing } from '@/entities/trip';

import type { DoneBarEntry } from './doneBar';

/**
 * TRIP-1121 · h06 "내 여행" 순서(01b D3) — [여행 중] 을 맨 위, 나머지를 그 아래. 두 묶음 모두 같은 비교자.
 * 일정이 아직 안 온(pending) 여행은 판정할 수 없으니 고정하지 않는다(INV-4). 입력은 건드리지 않는다 —
 * 페이지가 `list[i] ↔ itineraries[i]` 인덱스로 짝짓는다.
 */

/** TRIP-1122 · h06 정렬 시트의 세 기준 — 기기에 이 문자열 그대로 저장된다. */
export type MyTripsSortKey = 'recent' | 'start' | 'title';

/** 동률 보조키 — tripId 코드포인트 오름차순(로케일 무관, 결정론). */
function byTripId(a: Trip, b: Trip): number {
  return a.tripId < b.tripId ? -1 : a.tripId > b.tripId ? 1 : 0;
}

/** 최신순 — 갱신 시각 내림차순(없으면 생성 시각으로 접는다). */
export function byLatest(a: Trip, b: Trip): number {
  return (
    (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt) ||
    byTripId(a, b)
  );
}

/**
 * 출발일순 — "가까운 출발일부터"(Figma 보조 문구): 오늘 이후(오늘 포함) 출발을 오름차순으로 먼저,
 * 지난 출발을 내림차순으로 뒤. 날짜는 `YYYY-MM-DD` 라 문자열 비교가 곧 날짜 비교다.
 */
export function byStart(today: string): (a: Trip, b: Trip) => number {
  return (a, b) => {
    const aPast = a.startDate < today;
    const bPast = b.startDate < today;
    if (aPast !== bPast) return aPast ? 1 : -1;
    const primary = aPast
      ? b.startDate.localeCompare(a.startDate)
      : a.startDate.localeCompare(b.startDate);
    return primary || byTripId(a, b);
  };
}

/** 이름순 — 한글 가나다순(`'ko'` 규칙: 한글이 라틴보다 앞). */
export function byTitle(a: Trip, b: Trip): number {
  return a.title.localeCompare(b.title, 'ko') || byTripId(a, b);
}

/** 기기에서 읽은 값 해석 — 세 값과 정확히 같을 때만 그대로, 나머지는 최신순(INV-4). */
export function parseMyTripsSortKey(raw: unknown): MyTripsSortKey {
  return raw === 'start' || raw === 'title' ? raw : 'recent';
}

/**
 * TRIP-1786 · 「맨 위에 고정」 — 세 묶음 [여행 중] → [내가 고정(여행 중 아님)] → [나머지], 각 묶음은 같은 비교자.
 * 고정은 사용자가 고른 것이라 일정이 안 온(pending) 여행도 고정된다. 여행 중이면서 고정이면 여행 중 묶음에 한 번만 선다.
 * 목록에 없는 id 는 무시한다. 인자를 안 주면 종전 결과 그대로다.
 */
export function orderMyTrips(
  entries: readonly DoneBarEntry[],
  today: string,
  compare: (a: Trip, b: Trip) => number = byLatest,
  pinnedIds?: ReadonlySet<string>
): Trip[] {
  const ongoing: Trip[] = [];
  const pinnedRest: Trip[] = [];
  const rest: Trip[] = [];
  for (const { trip, itinerary } of entries) {
    const isOngoing =
      itinerary !== 'pending' && isTripOngoing(trip, itinerary.status, today);
    (isOngoing
      ? ongoing
      : pinnedIds?.has(trip.tripId)
        ? pinnedRest
        : rest
    ).push(trip);
  }
  return [
    ...ongoing.sort(compare),
    ...pinnedRest.sort(compare),
    ...rest.sort(compare),
  ];
}
