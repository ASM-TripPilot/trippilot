/**
 * e04 저장한 숙소 배선(TRIP-461 · US-STAY-09·04·03 · BR-U1-03). 조회·인증 판정·상태 판정·
 * 카드→e03 push 를 여기서 모은다 — 화면(`SavedStayListScreen`)은 완성된 값만 그린다.
 *
 * 카드 press 는 상세 라우트로 `stayId` 하나만 싣는다 — e03 가 `GET /stays/{stayId}` 로 스스로
 * 조회한다(TRIP-940 D0, 구 `SavedStay`→`StayItem` 합성 폐기). 외부키 없는 핀·수동 숙소는
 * `savedStayId` 로 폴백하고 e03 에서 400 식별자 오류 얼굴을 받는다(TRIP-940 Q3 — 등록 숙소 상세는
 * 정본 공백).
 *
 * 조회는 **읽기전용 재수출**(`features/trip/model/useSavedStays`)을 쓴다 — 토글 훅
 * (`features/save-stay/model/savedStays`)의 `remove` 는 외부키 역인덱스라 핀·수동 숙소를 못 지워
 * 목록 화면에 부적합하다(d02 선례). 하트 해제는 그래서 이 파일이 `savedStayId` 로 직접 지운다(TRIP-1429). 게스트는 `enabled: isAuthed=false` 로 조회를 아예 안
 * 내보내고, `isGuest` 를 상태 판정보다 먼저 화면에 내려 끝나지 않는 로딩을 피한다(d02 ★1).
 */
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

import { getAccessToken, isNotFound } from '@/shared/api';
import {
  deleteSavedStaysSavedStayId,
  getGetSavedStaysQueryKey,
} from '@/shared/api/index.hooks';
import type { NoticeBannerNotice } from '@/shared/ui/NoticeBanner';

import { resolvePlaceListState } from '@/features/explore';
import { stayKey } from '@/features/save-stay';
import {
  SavedStayListScreen,
  type SavedStayCardVM,
  type SavedStayFace,
} from './SavedStayListScreen';
import { useSavedStays } from '@/features/trip';

type RemoveFailure = {
  savedStayId: string;
  reason: 'base-in-use' | 'network';
};

// TRIP-1429 · 01b Q5 — 서버 문장은 그대로 내보이지 않는다. 409 는 다시 해도 같은 409 라 [다시 시도]가 없다.
const REMOVE_FAILURE_NOTICE: Record<
  RemoveFailure['reason'],
  NoticeBannerNotice
> = {
  'base-in-use': {
    message:
      '여행의 거점으로 쓰는 숙소라 지울 수 없어요\n여행에서 거점을 먼저 바꿔 주세요',
    action: null,
  },
  network: { message: '저장을 풀지 못했어요', action: 'retry' },
};

export function SavedStayPage(): ReactElement {
  // isAuthed 는 렌더 시점 1회 동기 판정(d02·StayDetailPage 선례 — "판정 대기" 제3 상태가 안 생긴다).
  const isAuthed = getAccessToken() !== null;
  const query = useSavedStays({ enabled: isAuthed });
  const queryClient = useQueryClient();

  // TRIP-1429 하트 해제(결정 ⑥) — 캐시를 고치지 않고 "이번 방문에서 지운 id" 집합으로 행을 가린다(d02
  // releasedPoiIds 선례). 실패하면 그 id 하나만 집합에서 빼므로 행이 서버 순서 그대로 제자리에 돌아오고,
  // 다른 행의 진행 중 해제는 건드리지 않는다 — 호출 전 목록 통째 복원은 이미 지운 다른 행을 되살린다
  // (traps-stay 「동시 토글 스냅숏 롤백」). 성공한 id 는 집합에 남긴다: 재조회가 아직 옛 목록을 줘도
  // 가려지고, savedStayId 는 다시 담으면 새로 생기므로 남겨도 다른 행을 가리지 않는다.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [removeFailure, setRemoveFailure] = useState<RemoveFailure | null>(
    null
  );

  // TRIP-1363 — 행(memo)에 내려가는 cards·handlePressCard 참조를 데이터가 같은 동안 고정한다.
  const savedStays = useMemo(
    () =>
      (query.data ?? []).filter((stay) => !removedIds.has(stay.savedStayId)),
    [query.data, removedIds]
  );

  // 장소 축(d02)과 같은 판정 함수 재사용(숙소 수로, hasQuery/hasCategory 는 늘 false).
  const listState = resolvePlaceListState({
    isPending: query.isPending,
    isError: query.isError,
    itemCount: savedStays.length,
    hasQuery: false,
    hasCategory: false,
  });
  // filter-zero 는 hasQuery/hasCategory 를 늘 false 로 불러 구조적으로 도달 불가 → results 로 접는다.
  const face: SavedStayFace =
    listState.kind === 'filter-zero' ? 'results' : listState.kind;

  const cards: SavedStayCardVM[] = useMemo(
    () =>
      savedStays.map((stay) => ({
        savedStayId: stay.savedStayId,
        name: stay.name,
      })),
    [savedStays]
  );

  const handlePressCard = useCallback(
    (savedStayId: string): void => {
      const stay = savedStays.find(
        (entry) => entry.savedStayId === savedStayId
      );
      if (stay === undefined) {
        return;
      }
      // 하트 저장분(외부키 있음)은 stayKey(=SOURCE:ID), 핀·수동(외부키 null)은 savedStayId 폴백 —
      // 폴백이 없으면 핀 숙소가 route key "null:null" 로 충돌한다(★2).
      const stayId =
        stay.externalSource && stay.externalId
          ? stayKey({
              externalSource: stay.externalSource,
              externalId: stay.externalId,
            })
          : stay.savedStayId;
      router.push({
        pathname: '/stays/[stayId]',
        params: { stayId },
      });
    },
    [savedStays]
  );

  const removeSavedStay = useCallback(
    async (savedStayId: string): Promise<void> => {
      // 실패 안내는 다음 조작에서 지운다(d02 선례).
      setRemoveFailure(null);
      setRemovedIds((prev) => new Set(prev).add(savedStayId));
      try {
        await deleteSavedStaysSavedStayId(savedStayId);
      } catch (error) {
        // 404 = 이미 없음 — 목표 상태라 되돌리지 않는다(되돌리면 지울 수 없는 유령 행, 01b Q3).
        if (!isNotFound(error)) {
          setRemovedIds((prev) => {
            const next = new Set(prev);
            next.delete(savedStayId);
            return next;
          });
          // 409 = 거점으로 쓰는 숙소(서버 SavedStayService — openapi 미기재). 그 밖은 다시 시도로.
          setRemoveFailure({
            savedStayId,
            reason:
              isAxiosError(error) && error.response?.status === 409
                ? 'base-in-use'
                : 'network',
          });
          return;
        }
      }
      // 같은 키를 보는 e02 하트·홈 배지·g02 거점 시트도 서버 목록으로 맞춘다.
      void queryClient.invalidateQueries({
        queryKey: getGetSavedStaysQueryKey(),
      });
    },
    [queryClient]
  );
  // 행(memo)에 내려가는 참조라 고정한다(TRIP-1363).
  const handlePressHeart = useCallback(
    (savedStayId: string): void => void removeSavedStay(savedStayId),
    [removeSavedStay]
  );

  return (
    <SavedStayListScreen
      savedStays={cards}
      face={face}
      isGuest={!isAuthed}
      onPressCard={handlePressCard}
      onPressHeart={handlePressHeart}
      removeNotice={
        removeFailure ? REMOVE_FAILURE_NOTICE[removeFailure.reason] : null
      }
      onRetryRemove={() => {
        if (removeFailure) handlePressHeart(removeFailure.savedStayId);
      }}
      onPressRegister={() => router.push('/stays/register')}
      onPressBrowse={() => router.push('/stays')}
      onRetry={() => void query.refetch()}
      onPressLogin={() => router.push('/(auth)/login')}
      onBack={() => router.back()}
    />
  );
}
