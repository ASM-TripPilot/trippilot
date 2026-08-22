import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

import {
  deleteSavedStaysSavedStayId,
  getGetSavedStaysQueryKey,
  postSavedStays,
  useGetSavedStays,
} from '@/shared/api/generated/saved-stays/saved-stays';
import type { SavedStay, StayItem } from '@/shared/api/generated/schemas';

import { buildSaveStayRequest } from './buildSaveStayRequest';
import { findSavedStayId, optimisticSavedStayId } from './savedStayIndex';
import { stayKey } from './stayKey';

/**
 * 숙소 저장 하트(♥) 토글 훅(TRIP-417) — 서버 상태의 단일 소유자는 TanStack Query 캐시다.
 * explore d04 `savedPlaces.ts`의 stay 판(인프라·장치 그대로, 매칭 키만 poiId →
 * externalSource+externalId(stayKey)로 다르다).
 *
 * 담기·해제 둘 다 서버 응답 전에 캐시를 먼저 고치고(낙관), 실패하면 호출 전 상태로 되돌린다.
 * ★ 실패 경로에서는 무효화하지 않는다 — 재요청이 서버 진실로 캐시를 덮으면 되돌린 것이
 * 롤백 때문인지 재요청 때문인지 구별할 수 없어진다(AC-4). 성공·409는 담은 목록 하나만
 * 무효화한다(Q5 — `GET /stays`가 파생 집계를 주지 않아 그쪽은 흔들 필요가 없다).
 *
 * ⚠️ 동명 훅 `useSavedStays`가 `features/trip/model`에도 있다(읽기전용 재수출) — 이 토글 훅과
 * 별개다(01b Seed Q7, cross-feature import 금지라 통합 불가·경로로 공존).
 */

export type SavedStaysFailureReason =
  | 'unauthenticated' // BR-U1-03 — 요청을 보내지 않는다
  | 'saved-id-unknown' // Q6 — 담은 목록이 아직 없어 보낼 savedStayId가 없다
  | 'not-found' // 404 — 담기: 없음/비-ACTIVE · 해제: 없음/타 계정(갈래를 나누지 않는다)
  | 'network';

export type SavedStaysOutcome =
  | { kind: 'saved' }
  | { kind: 'removed' }
  | { kind: 'failed'; reason: SavedStaysFailureReason };

function classifyFailure(error: unknown): 'not-found' | 'network' {
  return isAxiosError(error) && error.response?.status === 404
    ? 'not-found'
    : 'network';
}

export function useSavedStays(deps: { isAuthed: boolean }) {
  const queryClient = useQueryClient();
  // BR-U1-03 — 담기는 로그인 사용자만. 목록 조회도 미로그인이면 아예 보내지 않는다.
  const savedListQuery = useGetSavedStays({
    query: { enabled: deps.isAuthed },
  });
  const listKey = getGetSavedStaysQueryKey();

  // 담김 표시 키 목록 — 외부키(두 값 다 non-null)가 있는 담기 기록만 검색 카드와 매칭 가능하다
  // (핀·수동 등록은 외부키 null이라 어느 카드와도 매칭 안 됨). `enabled:false`는 새 요청만 막고
  // 로그인 중 채워진 캐시는 세션 만료 뒤에도 남으므로, 표시는 여기서 한 번 더 isAuthed로 접는다
  // (게스트에게 남의 담김이 새지 않게, BR-U1-03 — savedPlaces 선례와 동형).
  const savedKeys = deps.isAuthed
    ? (savedListQuery.data ?? [])
        .filter(
          (entry) => entry.externalSource != null && entry.externalId != null
        )
        .map((entry) => `${entry.externalSource}:${entry.externalId}`)
    : [];

  function isSaved(key: string): boolean {
    return savedKeys.includes(key);
  }

  function invalidateSavedStays(): void {
    void queryClient.invalidateQueries({ queryKey: listKey });
  }

  async function save(item: StayItem): Promise<SavedStaysOutcome> {
    if (!deps.isAuthed) {
      return { kind: 'failed', reason: 'unauthenticated' };
    }

    const previous = queryClient.getQueryData<SavedStay[]>(listKey);
    const now = new Date().toISOString();
    queryClient.setQueryData<SavedStay[]>(listKey, [
      ...(previous ?? []),
      {
        savedStayId: optimisticSavedStayId(stayKey(item)),
        name: item.name,
        coordConfirmed: false,
        registerRoute: 'MAP_SEARCH',
        externalSource: item.externalSource,
        externalId: item.externalId,
        lat: item.lat,
        lng: item.lng,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    try {
      await postSavedStays(buildSaveStayRequest(item));
      invalidateSavedStays();
      return { kind: 'saved' };
    } catch (error) {
      // 409(이미 담음) — 목표 상태와 결과 상태가 같다(INV-U1-04). 실패가 아니라 담김으로 수렴.
      if (isAxiosError(error) && error.response?.status === 409) {
        invalidateSavedStays();
        return { kind: 'saved' };
      }
      queryClient.setQueryData(listKey, previous);
      return { kind: 'failed', reason: classifyFailure(error) };
    }
  }

  async function remove(item: StayItem): Promise<SavedStaysOutcome> {
    if (!deps.isAuthed) {
      return { kind: 'failed', reason: 'unauthenticated' };
    }

    const previous = queryClient.getQueryData<SavedStay[]>(listKey);
    const savedStayId = findSavedStayId(previous, item);
    if (savedStayId === null) {
      return { kind: 'failed', reason: 'saved-id-unknown' };
    }

    queryClient.setQueryData<SavedStay[]>(
      listKey,
      (previous ?? []).filter((entry) => entry.savedStayId !== savedStayId)
    );

    try {
      await deleteSavedStaysSavedStayId(savedStayId);
      invalidateSavedStays();
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
    savedKeys,
    isPending: savedListQuery.isPending,
    isError: savedListQuery.isError,
    refetch: savedListQuery.refetch,
  };
}
