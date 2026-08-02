import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

import {
  deleteSavedPlacesSavedPlaceId,
  getGetPlacesQueryKey,
  getGetSavedPlacesQueryKey,
  postSavedPlaces,
  useGetSavedPlaces,
} from '@/shared/api/generated/places/places';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import { findSavedPlaceId, optimisticSavedPlaceId } from './savedPlaceIndex';

/**
 * 담기(♥) 토글 훅 — 서버 상태의 단일 소유자는 TanStack Query 캐시다(frontend/README.md §15·§66,
 * TRIP-220 AC-9). d04(탐색)·d02(담은 장소) 두 화면이 함께 쓸 자리라 화면과 분리했다.
 *
 * 담기·해제 둘 다 서버 응답 전에 캐시를 먼저 고치고(낙관), 실패하면 호출 전 상태로 되돌린다.
 * ★ 실패 경로에서는 무효화하지 않는다 — 재요청이 서버 진실로 캐시를 덮으면 되돌린 것이
 * 롤백 때문인지 재요청 때문인지 구별할 수 없어진다.
 */

export type SavedPlacesFailureReason =
  | 'unauthenticated' // BR-U1-03 — 요청을 보내지 않는다
  | 'saved-id-unknown' // 01b Seed Q2 — 담은 목록이 아직 없어 보낼 savedPlaceId가 없다
  | 'not-found' // 404 — 담기: POI 없음/비-ACTIVE · 해제: 없음/타 계정 (01b Seed Q3: 갈래를 나누지 않는다)
  | 'network';

export type SavedPlacesOutcome =
  | { kind: 'saved' }
  | { kind: 'removed' }
  | { kind: 'failed'; reason: SavedPlacesFailureReason };

function classifyFailure(error: unknown): 'not-found' | 'network' {
  return isAxiosError(error) && error.response?.status === 404
    ? 'not-found'
    : 'network';
}

export function useSavedPlaces(deps: { isAuthed: boolean }) {
  const queryClient = useQueryClient();
  // BR-U1-03 — 담기는 로그인 사용자만. 목록 조회도 미로그인이면 아예 보내지 않는다
  // (게스트가 화면을 열 때마다 401 → 리프레시 → 세션 만료 처리가 헛도는 것을 막는다).
  const savedListQuery = useGetSavedPlaces({
    query: { enabled: deps.isAuthed },
  });
  const listKey = getGetSavedPlacesQueryKey();

  function isSaved(poiId: string): boolean {
    return (savedListQuery.data ?? []).some(
      (entry) => entry.place.poiId === poiId
    );
  }

  /**
   * BR-U1-06 — savedCount는 GET /places가 주는 파생 집계라 담기·해제 둘 다 이 쪽도 흔든다.
   */
  function invalidateBoth(): void {
    void queryClient.invalidateQueries({ queryKey: listKey });
    void queryClient.invalidateQueries({ queryKey: getGetPlacesQueryKey() });
  }

  async function save(place: Place): Promise<SavedPlacesOutcome> {
    if (!deps.isAuthed) {
      return { kind: 'failed', reason: 'unauthenticated' };
    }

    const previous = queryClient.getQueryData<SavedPlace[]>(listKey);
    queryClient.setQueryData<SavedPlace[]>(listKey, [
      ...(previous ?? []),
      {
        savedPlaceId: optimisticSavedPlaceId(place.poiId),
        savedAt: new Date().toISOString(),
        place,
      },
    ]);

    try {
      await postSavedPlaces({ poiId: place.poiId });
      invalidateBoth();
      return { kind: 'saved' };
    } catch (error) {
      // 409(이미 담음) — 목표 상태와 결과 상태가 같다(INV-U1-04). 실패가 아니라 담김으로 수렴.
      if (isAxiosError(error) && error.response?.status === 409) {
        invalidateBoth();
        return { kind: 'saved' };
      }
      queryClient.setQueryData(listKey, previous);
      return { kind: 'failed', reason: classifyFailure(error) };
    }
  }

  async function remove(poiId: string): Promise<SavedPlacesOutcome> {
    if (!deps.isAuthed) {
      return { kind: 'failed', reason: 'unauthenticated' };
    }

    const previous = queryClient.getQueryData<SavedPlace[]>(listKey);
    const savedPlaceId = findSavedPlaceId(previous, poiId);
    if (savedPlaceId === null) {
      return { kind: 'failed', reason: 'saved-id-unknown' };
    }

    queryClient.setQueryData<SavedPlace[]>(
      listKey,
      (previous ?? []).filter((entry) => entry.place.poiId !== poiId)
    );

    try {
      await deleteSavedPlacesSavedPlaceId(savedPlaceId);
      invalidateBoth();
      return { kind: 'removed' };
    } catch (error) {
      queryClient.setQueryData(listKey, previous);
      return { kind: 'failed', reason: classifyFailure(error) };
    }
  }

  return { isSaved, save, remove };
}
