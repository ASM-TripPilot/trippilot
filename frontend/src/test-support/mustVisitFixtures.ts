import type {
  MustVisit,
  Place,
  SavedPlace,
  Trip,
} from '@/shared/api/index.schemas';

/**
 * '꼭 갈 곳' 화면 테스트 공용 픽스처(TRIP-1350) — 여행 1건 · 담은 곳 · 등록된 필수 방문지. 파일마다 `TRIP`/`SAVED`/`REGISTERED` 를
 * 다시 선언하던 자리를 대신한다. 값은 openapi `Trip.required`·`Place.required` 를 그대로 채운 것이다(상상해서 만들지 않는다).
 * 기간이 3일(2026-06-10~12)이라 날짜 칩이 정확히 3개다.
 */

export const TRIP_ID = '11111111-1111-1111-1111-111111111111';

export function makeTrip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-12',
    party: 1,
    companionType: null,
    budgetTotal: 800000,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-02T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...over,
  };
}

export const TRIP: Trip = makeTrip();

export function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '부산진구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

/** 담은 곳 1건 — `savedPlaceId` 는 `sp-{poiId}`. */
export function savedPlace(poiId: string, nameKo: string): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace(poiId, nameKo),
  };
}

/** 등록된 필수 방문지 1건(기본 `ANYTIME`) — `mustVisitId` 는 `mv-{poiId}`, 스냅샷은 `snap-{poiId}`. */
export function registered(
  poiId: string,
  over: Partial<MustVisit> = {}
): MustVisit {
  return {
    mustVisitId: `mv-${poiId}`,
    poiSnapshotId: `snap-${poiId}`,
    sourcePoiId: poiId,
    type: 'ANYTIME',
    ...over,
  };
}
