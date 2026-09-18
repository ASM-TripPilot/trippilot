import type {
  PlaceDataStatus,
  SavedPlace,
} from '@/shared/api/generated/schemas';

import { optimisticSavedPlaceId } from './savedPlaceIndex';

/**
 * d02 담은 장소의 순수 판정 2종(01b Seed Q2·Q3·Q8) — 정렬과 dataStatus 배지 매핑.
 *
 * `orderSavedPlaces`는 `savedAt` 오름차순(담은 순서)으로 세우되, 낙관 표식 항목
 * (`optimisticSavedPlaceId`로 만든 임시 id)은 임의의 `savedAt` 조합에서도 항상 맨 끝으로
 * 민다 — 그 값은 서버가 아니라 기기 시계에서 온다(`savedPlaces.ts` `save()`의
 * `new Date().toISOString()`)라, 시계가 뒤로 밀린 단말에서는 순서를 못 믿는다. 캐시가 준
 * 배열은 제자리에서 바꾸지 않는다(`visiblePlaces` 관례 — TanStack Query 리렌더 통지 보존).
 */
function isOptimistic(entry: SavedPlace): boolean {
  return entry.savedPlaceId === optimisticSavedPlaceId(entry.place.poiId);
}

function compareNormal(a: SavedPlace, b: SavedPlace): number {
  const byTime = Date.parse(a.savedAt) - Date.parse(b.savedAt);
  if (byTime !== 0) return byTime;
  return a.savedPlaceId < b.savedPlaceId
    ? -1
    : a.savedPlaceId > b.savedPlaceId
      ? 1
      : 0;
}

export function orderSavedPlaces(saved: SavedPlace[]): SavedPlace[] {
  const normals = saved.filter((entry) => !isOptimistic(entry));
  const optimistics = saved.filter(isOptimistic);

  return [...normals.sort(compareNormal), ...optimistics];
}

/** dataStatus → 배지 문구(01b Seed Q8). null = 배지 없음. `Record`라 enum이 늘면 tsc가
 * 먼저 깨진다(계약이 담기 목록에 CLOSED·UNVERIFIED도 포함한다고 적었고, 항목을 숨기지 않고
 * 배지로 구분한다 — BR-U1-06). */
export const SAVED_PLACE_BADGE: Record<PlaceDataStatus, string | null> = {
  ACTIVE: null,
  CLOSED: '폐업',
  UNVERIFIED: '미확인',
  LOST: '미확인',
};
