import type {
  ItineraryUnplacedMustVisitsItem,
  SavedPlace,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-1094 · 서버가 보낸 "일정에 넣지 못한 꼭 갈 곳"에 담은 장소의 이름을 붙인다.
 *
 * 조인 키는 `poiId === SavedPlace.place.poiId` 하나다 — 서버가 `must_visit.sourcePoiId` 를 그대로
 * 보고하고, 그 값이 담은 장소의 poiId 다(`joinMustVisits` 와 같은 키 규칙).
 *
 * 이름을 못 찾으면 `null` 로 두고 항목은 빼지 않는다. h02 목록의 `MUST_VISIT_NAME_PLACEHOLDER` 와
 * 정책이 반대다 — 여기서는 대체 이름을 만들지 않고 서버 문구만 보인다(결정 3 · INV-4).
 * 사유 코드는 행에 싣지 않는다 — 화면이 사유로 분기해 문구를 지어낼 통로를 자료형에서 막는다.
 */
export interface UnplacedMustVisitRow {
  poiId: string;
  name: string | null;
  /** 서버 문구 그대로. */
  message: string;
}

export function resolveUnplacedNames(input: {
  unplaced: ItineraryUnplacedMustVisitsItem[] | undefined;
  savedPlaces: SavedPlace[];
}): UnplacedMustVisitRow[] {
  const nameByPoiId = new Map(
    input.savedPlaces.map((entry) => [entry.place.poiId, entry.place.nameKo])
  );
  return (input.unplaced ?? []).map((item) => ({
    poiId: item.poiId,
    name: nameByPoiId.get(item.poiId) ?? null,
    message: item.message,
  }));
}
