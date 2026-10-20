import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';

import { isAlreadyRegistered, isNotFound } from '@/shared/api';
import {
  useGetTripsTripIdItineraryRevisions,
  usePostTripsTripIdItineraryRevisionsRevisionIdRestore,
} from '@/shared/api/index.hooks';
import { showToast } from '@/shared/ui/Toast';

import { ItineraryHistoryView, type HistoryFace } from './ItineraryHistoryView';

/**
 * h36 일정 변경 이력 배선(TRIP-1513) — 목록 조회·되돌리기 확인·요청·무효화·이동을 소유한다.
 * 리비전 = "그 시점의 일정 전체를 저장해 둔 되돌리기 지점". 되돌리기는 이력을 지우지 않고 새 RESTORE 리비전을 쌓는다.
 *
 * - 목록은 `limit=500`(서버 최대)으로 1번 받아 서버 순서 그대로 그린다.
 * - [되돌리기]는 확인 다이얼로그를 거쳐 확정할 때만 POST 한다. 연타는 ref 잠금으로 1회만(isPending 은 다음
 *   렌더에야 참이라 같은 틱 연타를 못 막는다). 성공 이동에선 잠금을 풀지 않는다.
 * - 성공 = 이 여행 일정 쿼리 전부 무효화 + 토스트 + 일정 화면으로 `replace`. 실패는 침묵하지 않는다(INV-4):
 *   409 "되돌릴 수 없어요" · 404 "찾을 수 없어요" 는 인라인 배너, 그 밖은 오류 얼굴 + [다시 시도].
 */

const RESTORED_TOAST = '일정을 되돌렸어요';
const CONFLICT_NOTE =
  '지금은 되돌릴 수 없어요. 확정된 일정이거나 일정을 만드는 중이에요.';
const NOT_FOUND_NOTE = '이 버전을 찾을 수 없어요';

export function ItineraryHistoryPage({
  tripId,
}: {
  tripId: string;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const revisions = useGetTripsTripIdItineraryRevisions(tripId, { limit: 500 });
  // TError=unknown 으로 열어 onError 의 error 를 axios 판정에 그대로 태운다(ItineraryEditPage 선례).
  const restore =
    usePostTripsTripIdItineraryRevisionsRevisionIdRestore<unknown>();

  // 확인 다이얼로그가 가리키는 리비전(null = 닫힘).
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const lockRef = useRef(false);

  const rows = revisions.data?.revisions ?? [];
  const face: HistoryFace = restoreFailed
    ? 'error'
    : revisions.isPending
      ? 'loading'
      : revisions.isError
        ? 'error'
        : rows.length === 0
          ? 'empty'
          : 'list';

  function handleConfirm(): void {
    if (lockRef.current || pendingId === null) return;
    lockRef.current = true;
    restore.mutate(
      { tripId, revisionId: pendingId },
      {
        onSuccess: () => {
          const prefix = `/trips/${tripId}/itinerary`;
          void queryClient.invalidateQueries({
            predicate: (q) =>
              typeof q.queryKey[0] === 'string' &&
              q.queryKey[0].startsWith(prefix),
          });
          showToast({
            message: RESTORED_TOAST,
            testID: 'itinerary-history-restored',
          });
          router.replace(`/trips/${tripId}/itinerary` as Href);
        },
        onError: (error) => {
          lockRef.current = false;
          setPendingId(null);
          if (isAlreadyRegistered(error)) setRestoreNotice(CONFLICT_NOTE);
          else if (isNotFound(error)) setRestoreNotice(NOT_FOUND_NOTE);
          else setRestoreFailed(true);
        },
      }
    );
  }

  function handleRetry(): void {
    setRestoreFailed(false);
    setRestoreNotice(null);
    void revisions.refetch();
  }

  return (
    <ItineraryHistoryView
      face={face}
      revisions={rows}
      now={new Date()}
      confirming={pendingId !== null}
      restoring={restore.isPending}
      restoreNotice={restoreNotice}
      onBack={() =>
        router.canGoBack()
          ? router.back()
          : router.replace(`/trips/${tripId}/itinerary` as Href)
      }
      onRetry={handleRetry}
      onRestore={(revisionId) => {
        setRestoreNotice(null);
        setPendingId(revisionId);
      }}
      onCancelConfirm={() => setPendingId(null)}
      onConfirm={handleConfirm}
    />
  );
}
