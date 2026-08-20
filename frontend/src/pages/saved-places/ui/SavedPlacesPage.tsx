/**
 * d02 담은 장소 배선(TRIP-223 · US-EXPL-04 · US-SHELL-05 · BR-U1-04·06·09·37). 목록 조회·정렬·
 * 해제·게스트 판정·로딩 실패 얼굴을 여기서 모은다 — 화면(`SavedPlaceListScreen`)은 결과만
 * 그린다(props만).
 *
 * **TRIP-394로 해제 동작이 뒤집혔다** — 하트를 눌러도 행이 사라지지 않고 **자리에 남아 빈 하트**가
 * 되고, 빈 하트를 다시 누르면 같은 자리에서 되돌린다(재담김). 서버는 실제로 해제/재담김되고,
 * 실패하면 배너 + 하트 원복(INV-4). 그래서 페이지가 방문 범위 상태 둘을 소유한다:
 * `releasedPoiIds`(빈 하트인 poiId)와 `snapshots`(원본 보존). `mergeReleasedSnapshots`가
 * `useSavedPlaces`의 서버 목록과 스냅숏을 합쳐 정렬(01b Seed Q1·Q2·Q3)하고, 조회 상태
 * (`isPending`·`isError`)를 `resolvePlaceListState`에 태워 얼굴을 정한다(d04와 같은 판정 함수
 * 재사용 — hasQuery·hasCategory는 늘 false라 filter-zero는 구조적으로 도달 불가).
 * **게스트 분기(`isGuest`)는 이 판정과 별개로 화면에 그대로 내려간다** — `enabled: isAuthed`인
 * 쿼리는 게스트에게 `isPending`이 영원히 true라(★1), 화면이 게스트를 상태 판정보다 먼저 봐야
 * 끝나지 않는 로딩을 피한다.
 *
 * 실패는 `REMOVE_FAILURE_NOTICE`(해제)·`SAVE_FAILURE_NOTICE`(되돌리기)로 배너를 세운다(INV-4).
 * 배너는 타이머 없이 다음 조작에서 지운다(01b Seed Q9) — 매 조작 시작에서 `removeError`를 비운다.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import type { SavedPlace } from '@/shared/api/generated/schemas';
import { getAccessToken } from '@/shared/api/tokenManager';
import {
  getGetSavedStaysQueryKey,
  useDeleteSavedStaysSavedStayId,
} from '@/shared/api/generated/saved-stays/saved-stays';

import { resolvePlaceListState } from '@/features/explore/model/placeListState';
import {
  REMOVE_FAILURE_NOTICE,
  SAVE_FAILURE_NOTICE,
  type PlaceSaveNotice,
} from '@/features/explore/model/placeSaveGuard';
import { orderSavedPlaces } from '@/features/explore/model/savedPlaceList';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import {
  SavedPlaceListScreen,
  type StayRowVM,
} from '@/features/explore/ui/SavedPlaceListScreen';
import { useSavedStays } from '@/features/trip/model/useSavedStays';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { formatStayDateRange } from '@/features/trip/model/stayDateImport';

/** 실패 시 재시도가 다시 밟아야 할 마지막 조작 — 해제냐 되돌리기냐를 함께 기억한다. */
type LastAttempt = { saved: SavedPlace; mode: 'release' | 'restore' };

/**
 * 방문 범위 병합 — 서버 목록과 이번 방문에 해제한 스냅숏을 하나로 세운다(TRIP-394). 되돌리기
 * (재담김) 응답이 **더 늦은 savedAt**을 줘도 스냅숏의 원 정렬 키로 덮어써 위치를 지키고(같은
 * 자리 복귀, 02a ★3), 서버 목록에서 빠진 해제 항목은 스냅숏을 다시 끼워 넣어 빈 하트로 살린다.
 */
function buildDisplayList(
  serverPlaces: SavedPlace[],
  releasedPoiIds: Set<string>,
  snapshots: Map<string, SavedPlace>
): SavedPlace[] {
  const overridden = serverPlaces.map((entry) => {
    const snap = snapshots.get(entry.place.poiId);
    return snap
      ? { ...entry, savedPlaceId: snap.savedPlaceId, savedAt: snap.savedAt }
      : entry;
  });
  const presentPoiIds = new Set(overridden.map((entry) => entry.place.poiId));
  const orphanedReleased = [...releasedPoiIds]
    .filter((poiId) => !presentPoiIds.has(poiId))
    .map((poiId) => snapshots.get(poiId))
    .filter((entry): entry is SavedPlace => entry !== undefined);

  return orderSavedPlaces([...overridden, ...orphanedReleased]);
}

export function SavedPlacesPage(): ReactElement {
  const [removeError, setRemoveError] = useState<PlaceSaveNotice | null>(null);
  const [lastAttempted, setLastAttempted] = useState<LastAttempt | null>(null);
  // 이번 방문에서 하트를 눌러 해제한(빈 하트) poiId 들. 화면을 떠나면(재마운트) 리셋된다(Q1=a).
  const [releasedPoiIds, setReleasedPoiIds] = useState<Set<string>>(
    () => new Set()
  );
  // 해제한 항목의 원본 스냅숏(poiId→SavedPlace) — 서버에서 빠져도 행을 그리고, 되돌리기가
  // 준 더 늦은 savedAt 대신 원 savedAt 으로 정렬 위치를 지킨다(같은 자리 복귀, 02a ★3).
  const [snapshots, setSnapshots] = useState<Map<string, SavedPlace>>(
    () => new Map()
  );

  const isAuthed = getAccessToken() !== null;
  const { savedPlaces, isPending, isError, refetch, save, remove } =
    useSavedPlaces({ isAuthed });
  // 숙소 축(TRIP-449) — 읽기는 trip 재수출(GET /saved-stays, 게스트엔 `enabled:isAuthed` 로 요청
  // 0). 해제는 savedStayId 직접 삭제(생성 클라) + 목록 무효화 — 토글 훅 remove 는 외부키 역인덱스라
  // 핀·수동 숙소를 못 지워 안 쓴다(brief §90).
  const stayQuery = useSavedStays({ enabled: isAuthed });
  const queryClient = useQueryClient();
  const removeStay = useDeleteSavedStaysSavedStayId({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: getGetSavedStaysQueryKey(),
        }),
    },
  });

  const displayList = buildDisplayList(savedPlaces, releasedPoiIds, snapshots);
  const listState = resolvePlaceListState({
    isPending,
    isError,
    itemCount: displayList.length,
    hasQuery: false,
    hasCategory: false,
  });

  const stayList = stayQuery.data ?? [];
  // 장소 축과 같은 판정 함수 재사용(숙소 수로, hasQuery·hasCategory 는 늘 false).
  const stayState = resolvePlaceListState({
    isPending: stayQuery.isPending,
    isError: stayQuery.isError,
    itemCount: stayList.length,
    hasQuery: false,
    hasCategory: false,
  });
  const stayRows: StayRowVM[] = stayList.map((stay) => ({
    savedStayId: stay.savedStayId,
    name: stay.name,
    dateLabel:
      stay.checkIn && stay.checkOut
        ? formatStayDateRange(stay.checkIn, stay.checkOut)
        : undefined,
  }));
  // 통합 빈 상태는 페이지가 파생해 내린다 — 두 축이 모두 조회 정착 + 0건일 때만(게스트·조회
  // 중·부분 실패는 empty 가 아니다, 우선순위 guest > loading > error > results > empty).
  const showEmpty =
    isAuthed && listState.kind === 'empty' && stayState.kind === 'empty';
  const removingStayIds =
    removeStay.isPending && removeStay.variables
      ? [removeStay.variables.savedStayId]
      : [];

  // 해제 — 낙관 업데이트: 먼저 빈 하트로 바꾸고(스냅숏 보존) 서버에 DELETE. 실패면 찬 하트로 원복.
  async function attemptRelease(saved: SavedPlace): Promise<void> {
    const { poiId } = saved.place;
    setRemoveError(null);
    setLastAttempted({ saved, mode: 'release' });
    setSnapshots((prev) => new Map(prev).set(poiId, saved));
    setReleasedPoiIds((prev) => new Set(prev).add(poiId));

    const outcome = await remove(poiId);
    if (outcome.kind === 'failed') {
      setReleasedPoiIds((prev) => {
        const next = new Set(prev);
        next.delete(poiId);
        return next;
      });
      setRemoveError(REMOVE_FAILURE_NOTICE[outcome.reason]);
    }
  }

  // 되돌리기 — 낙관 업데이트: 먼저 찬 하트로 바꾸고 서버에 POST(재담김). 실패면 빈 하트로 원복.
  async function attemptRestore(saved: SavedPlace): Promise<void> {
    const { poiId } = saved.place;
    setRemoveError(null);
    setLastAttempted({ saved, mode: 'restore' });
    setReleasedPoiIds((prev) => {
      const next = new Set(prev);
      next.delete(poiId);
      return next;
    });

    const outcome = await save(saved.place);
    if (outcome.kind === 'failed') {
      setReleasedPoiIds((prev) => new Set(prev).add(poiId));
      setRemoveError(SAVE_FAILURE_NOTICE[outcome.reason]);
    }
  }

  function handlePressRemove(saved: SavedPlace): void {
    void attemptRelease(saved);
  }

  function handlePressRestore(saved: SavedPlace): void {
    void attemptRestore(saved);
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
      void (lastAttempted.mode === 'release'
        ? attemptRelease(lastAttempted.saved)
        : attemptRestore(lastAttempted.saved));
    }
  }

  return (
    <SavedPlaceListScreen
      savedPlaces={displayList}
      state={listState}
      removeError={removeError}
      isGuest={!isAuthed}
      releasedPoiIds={[...releasedPoiIds]}
      onPressRemove={handlePressRemove}
      onPressRestore={handlePressRestore}
      onPressCreateTrip={() => {
        // TRIP-458: d02 CTA 는 "진입"으로 친다(위저드 셸 JSDoc D3). 그런데 위저드 안 '더 담기'로
        // d02 를 열고 돌아오면 `trips/new` 레이아웃이 스택에 살아 있어 셸 마운트의 `resetMustVisits`
        // 가 재발화하지 않는다 → 직전에 x 로 뺀 poiId 가 `excludedMustVisitPoiIds` 에 남고, 추가 전용
        // 재시드가 그걸 건너뛰어 '꼭 갈 곳'이 빈 채 열린다. 여기서 직접 reset 해 그 잔존 기억을 비운다
        // (셸 재마운트라는 jest 무심판 경로에 기대지 않아 회귀를 통합 테스트로 잡을 수 있다).
        useTripWizardStore.getState().resetMustVisits();
        router.push('/trips/new/step1');
      }}
      onPressBrowse={() => router.push('/explore/places')}
      onRetry={handleRetry}
      onPressLogin={() => router.push('/(auth)/login')}
      onPressRemoveErrorAction={handlePressRemoveErrorAction}
      onBack={() => router.back()}
      savedStays={stayRows}
      stayState={stayState}
      onRemoveStay={(savedStayId) => removeStay.mutate({ savedStayId })}
      removingStayIds={removingStayIds}
      showEmpty={showEmpty}
    />
  );
}
