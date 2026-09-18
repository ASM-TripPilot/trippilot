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

  // d04(TRIP-221) 01b Seed Q2 ⓐ — CTA 숫자·하트 상태의 재료를 이 훅 하나로 모은다. 페이지가
  // `GET /saved-places`를 따로 부르면 `enabled: isAuthed` 가드를 두 곳에 복제하게 되고,
  // 그 복제가 TRIP-220 W-3(가드 누락)이 났던 자리다 — 캐시 소유자를 하나로 유지한다.
  // `enabled: deps.isAuthed`는 새 요청만 막고, 로그인 중 채워진 캐시는 세션 만료 뒤에도
  // 그대로 남는다 — 그래서 표시는 여기서 한 번 더 isAuthed로 접는다(게스트에게 남의 담김
  // 표시가 새지 않게, BR-U1-03).
  const savedPoiIds = deps.isAuthed
    ? (savedListQuery.data ?? []).map((entry) => entry.place.poiId)
    : [];

  // TRIP-223(d02) — 목록 원본 자체가 필요한 첫 소비자(01b Seed Q1). savedPoiIds와 같은 이유로
  // isAuthed를 한 번 더 접는다: enabled:false는 새 요청만 막고, 로그인 중 채워진 캐시는
  // 세션 만료 뒤에도 남는다(BR-U1-03).
  const savedPlaces = deps.isAuthed ? (savedListQuery.data ?? []) : [];

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

  return {
    isSaved,
    save,
    remove,
    savedPoiIds,
    savedPlaces,
    // TRIP-223(d02) — 01b Seed Q6(4얼굴)이 여기서 나온다. `enabled:false`인 게스트 쿼리는
    // isPending이 영원히 true다(fetchStatus는 idle) — 이 값을 그대로 상태 판정에 태우면
    // 게스트가 끝나지 않는 스켈레톤을 본다. 그래서 게스트 분기는 이 값보다 먼저 판정해야 한다.
    isPending: savedListQuery.isPending,
    isError: savedListQuery.isError,
    refetch: savedListQuery.refetch,
  };
}
