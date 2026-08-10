import type {
  MustVisit,
  MustVisitType,
  SavedPlace,
} from '@/shared/api/generated/schemas';
import type { MapPin } from '@/shared/map';

/**
 * h05 필수 방문지 목록의 순수 판정 2종 — 조인과 얼굴.
 *
 * 화면은 조회 상태를 모른다(`features` 경계 · 조합은 `pages` 층 몫). 그래서 "언제 어느 얼굴인가"를
 * 여기서 값 하나로 정하고 화면은 그것만 받는다(`mustVisitSeed.resolveMustVisitSection` 선례).
 */

/** 담은 목록에서 이름을 못 얻은 항목의 이름 자리. 숨기지 않고 드러내는 것이 사용자 동결
 * 결정이다(INV-4 · BR-U1-55) — 빈칸으로 두면 침묵 실패와 구별되지 않는다. */
export const MUST_VISIT_NAME_PLACEHOLDER = '이름을 불러오지 못한 곳';

export interface MustVisitListItem {
  /** 해제(DELETE)가 쓰는 등록 건 id. */
  mustVisitId: string;
  /** 조인·라우팅·셀렉터가 쓰는 장소 id. */
  sourcePoiId: string;
  /** 조인 실패면 `null` — 목록에서 빼지 않는다. */
  name: string | null;
  imageUrl: string | null;
  type: MustVisitType;
  fixedDate?: string;
  fixedStart?: string;
}

export type MustVisitListView =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'failed' }
  | { kind: 'listed'; items: MustVisitListItem[]; staleFailed: boolean };

/**
 * 등록 건(`must_visit`)과 담은 장소(`saved-places`)를 잇는다. 조인 키는
 * `MustVisit.sourcePoiId` ↔ `SavedPlace.place.poiId` 로 **이름이 서로 다르다**.
 *
 * `dwellMin` 은 옮기지 않는다 — 솔버 입력이지 표시값이 아니라(INV-3), 화면이 받을 수 없는 값은
 * 화면이 그릴 수도 없다.
 */
export function joinMustVisits(input: {
  mustVisits: MustVisit[];
  savedPlaces: SavedPlace[];
}): MustVisitListItem[] {
  const placeByPoiId = new Map(
    input.savedPlaces.map((entry) => [entry.place.poiId, entry.place])
  );
  return input.mustVisits.map((entry) => {
    const place = placeByPoiId.get(entry.sourcePoiId);
    return {
      mustVisitId: entry.mustVisitId,
      sourcePoiId: entry.sourcePoiId,
      name: place?.nameKo ?? null,
      imageUrl: place?.imageUrl ?? null,
      type: entry.type,
      fixedDate: entry.fixedDate ?? undefined,
      fixedStart: entry.fixedStart ?? undefined,
    };
  });
}

/**
 * 지도에 찍을 번호 핀. 좌표는 담은 장소(`saved-places`)에만 있으므로 조인과 같은 키로 다시
 * 읽는다 — 좌표를 못 얻은 항목은 **건너뛰되 뒤 항목의 번호를 당기지 않는다**(`buildDraftPins`
 * 와 같은 규칙). 재번호하면 사용자가 지도 ② 를 누르고 카드 ② 를 기대할 때 다른 장소가 나온다.
 *
 * 좌표를 `MustVisitListItem` 에 싣지 않는 이유: 그 자료형의 키 목록이 `dwellMin` 을 막는
 * INV-3 가드라(위 `joinMustVisits` 주석) 표시에 안 쓰는 값으로 넓히지 않는다. 조인과 핀이
 * 같은 키 규칙 위에 있다는 것은 `mustVisitList.test.ts` C8 이 교차로 잰다.
 */
export function buildMustVisitPins(input: {
  items: Pick<MustVisitListItem, 'sourcePoiId'>[];
  savedPlaces: SavedPlace[];
}): MapPin[] {
  const placeByPoiId = new Map(
    input.savedPlaces.map((entry) => [entry.place.poiId, entry.place])
  );
  return input.items.flatMap((item, index) => {
    const place = placeByPoiId.get(item.sourcePoiId);
    return place === undefined
      ? []
      : [{ number: index + 1, lat: place.lat, lng: place.lng }];
  });
}

/**
 * 얼굴 판정 — **items 를 가장 먼저 본다.** 이미 도착한 목록은 재조회 실패도 재로딩도 덮지
 * 못하고, 실패는 `staleFailed` 라는 별도 축으로 같은 값 안에 실려 나간다. 목록도 살고 실패도
 * 삼켜지지 않는다(문제로그 2026-08-04 · INV-4).
 */
export function resolveMustVisitListView(input: {
  items: MustVisitListItem[];
  loading: boolean;
  failed: boolean;
}): MustVisitListView {
  if (input.items.length > 0) {
    return { kind: 'listed', items: input.items, staleFailed: input.failed };
  }
  if (input.loading) return { kind: 'loading' };
  if (input.failed) return { kind: 'failed' };
  return { kind: 'empty' };
}
