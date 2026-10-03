import type {
  BaseAssignment,
  SavedStay,
  Trip,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-605 · l04 — SavedStay ↔ 여행 역참조 파생(연결 여행). **순수 함수**(조회·부수효과 없음).
 *
 * SavedStay 에는 `tripId` 가 없으므로 "이 숙소가 어느 여행에 연결됐나"는 모든 여행의 거점
 * 목록(`bases[].savedStayId`)을 뒤져 거꾸로 찾는다(역참조). 화면이 재계산하지 않게 이 조각에 담는다.
 *
 * 보장(계약):
 *  - 어떤 여행의 거점이 이 숙소면 그 여행이 연결 여행 → `{tripId, tripName(=Trip.title), baseAssignmentId}`.
 *  - **savedStays 가 구동자** — 바깥 루프가 savedStays 라, 거점에만 있고 savedStays 엔 없는 유령 id 는
 *    Map 에 아예 안 들어온다(자연 배제).
 *  - **첫 여행 승(first-wins)** — 한 숙소가 여러 여행의 거점이면 `trips` 순서상 먼저 만난 여행에서 `break`.
 */
export interface StayTripLink {
  tripId: string;
  tripName: string;
  baseAssignmentId: string;
}

export function buildStayTripLink(
  savedStays: SavedStay[],
  trips: Trip[],
  basesByTripId: Record<string, BaseAssignment[]>
): Map<string, StayTripLink> {
  const links = new Map<string, StayTripLink>();

  for (const stay of savedStays) {
    for (const trip of trips) {
      const base = (basesByTripId[trip.tripId] ?? []).find(
        (b) => b.savedStayId === stay.savedStayId
      );
      if (base) {
        links.set(stay.savedStayId, {
          tripId: trip.tripId,
          tripName: trip.title,
          baseAssignmentId: base.baseAssignmentId,
        });
        break; // 첫 여행 승 — 뒤 여행은 안 본다.
      }
    }
  }

  return links;
}
