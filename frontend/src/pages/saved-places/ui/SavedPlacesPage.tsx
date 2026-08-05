/**
 * d02 담은 장소 배선(TRIP-223 · US-EXPL-04 · US-SHELL-05 · BR-U1-04·06·09·37). 목록 조회·정렬·
 * 해제·게스트 판정·로딩 실패 얼굴을 여기서 모은다 — 화면(`SavedPlaceListScreen`)은 결과만
 * 그린다(props만).
 *
 * `useSavedPlaces`가 준 `savedPlaces`(원본)를 `orderSavedPlaces`로 담은 순서로 세우고
 * (01b Seed Q2·Q3), 조회 상태(`isPending`·`isError`)를 `resolvePlaceListState`에 태워 얼굴을
 * 정한다(d04와 같은 판정 함수 재사용 — hasQuery·hasCategory는 늘 false라 filter-zero는
 * 구조적으로 도달 불가). **게스트 분기(`isGuest`)는 이 판정과 별개로 화면에 그대로 내려간다**
 * — `enabled: isAuthed`인 쿼리는 게스트에게 `isPending`이 영원히 true라(★1), 화면이 게스트를
 * 상태 판정보다 먼저 봐야 끝나지 않는 로딩을 피한다.
 *
 * 해제 실패는 낙관 롤백 뒤 `REMOVE_FAILURE_NOTICE`로 배너를 세운다(INV-4). 배너는 타이머 없이
 * 다음 조작(다른 행 해제·재시도)에서 지운다(01b Seed Q9) — `attemptRemove`가 매 호출 시작에서
 * `removeError`를 비운다.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { router } from 'expo-router';

import type { SavedPlace } from '@/shared/api/generated/schemas';
import { getAccessToken } from '@/shared/api/tokenManager';

import { resolvePlaceListState } from '@/features/explore/model/placeListState';
import {
  REMOVE_FAILURE_NOTICE,
  type PlaceSaveNotice,
} from '@/features/explore/model/placeSaveGuard';
import { orderSavedPlaces } from '@/features/explore/model/savedPlaceList';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { SavedPlaceListScreen } from '@/features/explore/ui/SavedPlaceListScreen';

export function SavedPlacesPage(): ReactElement {
  const [removeError, setRemoveError] = useState<PlaceSaveNotice | null>(null);
  const [lastAttempted, setLastAttempted] = useState<SavedPlace | null>(null);

  const isAuthed = getAccessToken() !== null;
  const { savedPlaces, isPending, isError, refetch, remove } = useSavedPlaces({
    isAuthed,
  });

  const ordered = orderSavedPlaces(savedPlaces);
  const listState = resolvePlaceListState({
    isPending,
    isError,
    itemCount: ordered.length,
    hasQuery: false,
    hasCategory: false,
  });

  async function attemptRemove(saved: SavedPlace): Promise<void> {
    setRemoveError(null);
    setLastAttempted(saved);

    const outcome = await remove(saved.place.poiId);
    if (outcome.kind === 'failed') {
      setRemoveError(REMOVE_FAILURE_NOTICE[outcome.reason]);
    }
  }

  function handlePressRemove(saved: SavedPlace): void {
    void attemptRemove(saved);
  }

  function handleRetry(): void {
    setRemoveError(null);
    void refetch();
  }

  function handlePressRemoveErrorAction(): void {
    if (removeError?.action === 'login') {
      router.push('/(auth)/login');
      return;
    }
    if (removeError?.action === 'retry' && lastAttempted) {
      void attemptRemove(lastAttempted);
    }
  }

  return (
    <SavedPlaceListScreen
      savedPlaces={ordered}
      state={listState}
      removeError={removeError}
      isGuest={!isAuthed}
      onPressRemove={handlePressRemove}
      onPressCreateTrip={() => router.push('/trips/new/step1')}
      onPressBrowse={() => router.push('/explore/places')}
      onRetry={handleRetry}
      onPressLogin={() => router.push('/(auth)/login')}
      onPressRemoveErrorAction={handlePressRemoveErrorAction}
      onBack={() => router.back()}
    />
  );
}
