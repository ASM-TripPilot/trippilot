import { useQueryClient } from '@tanstack/react-query';

import {
  getGetTripsTripIdVisitsVisitCheckIdPhotosQueryKey,
  postTripsTripIdVisitsVisitCheckIdPhotos,
  useGetTripsTripIdVisitsVisitCheckIdPhotos,
} from '@/shared/api/index.hooks';
import type { VisitPhoto } from '@/shared/api/index.schemas';

import {
  photoAttach,
  type PhotoAssetMeta,
} from '@/features/attach-visit-media';
import { useVisitMemo } from '@/features/attach-visit-media';
import { failedUnlessNotFound } from './failedUnlessNotFound';

/**
 * TRIP-566 · AC-5 · BR-U5-13 — 방문 첨부 배선 훅(사진 GET/POST · 메모 PUT upsert).
 *
 * 무엇을 보장하나:
 *  - GET photos 의 items/count 를 그대로 노출한다(다건).
 *  - `addPhoto` = `photoAttach`(동의 게이트) → POST photos → 성공 시 photos 쿼리 무효화(재조회로 목록 성장).
 *  - `saveMemo` = 공백만이면 **PUT 0회**(무의미 upsert 방지), 아니면 PUT memo(만들기/고치기 안 나눔).
 *
 * ★ 새 HTTP 함수를 만들지 않는다 — 생성 클라이언트의 3함수만 재사용한다.
 *   동의 게이트는 순수 함수 `photoAttach` 가 지므로 이 훅은 gpsConsent 를 그대로 통과시킨다.
 *
 * TRIP-1797 — 사진 여러 장 한 번에·실패 재시도는 `useMultiPhotoAttach`(features/attach-visit-media)로 이사했다(TRIP-760 의
 *   `attachPhoto`·`failedUploads`·`retryUpload` 삭제). `addPhoto` 는 남았지만 운영 호출처는 없다.
 *
 * TRIP-1078 · 메모 세션 캐시(`saveMemo`·`savedMemo`)는 `useVisitMemo` 가 진다(TRIP-1117 — 허브와 키 한 벌).
 *   TRIP-1415 — 서버 memo 시드와 입력 잠금(`memoReady`)도 그 훅 것을 그대로 넘긴다.
 *   TRIP-1751 — 불러오기 실패 신호(`memoLoadFailed`·`memoLoadOffline`·`memoLoadRetrying`·`retryMemoLoad`)도 통과시킨다.
 * TRIP-1757 — 사진 목록 실패 신호(`photoLoadFailed`·`photoLoadRetrying`·`retryPhotoLoad`): 404 아닌 실패로 목록을 못 받은 채일 때만 —
 *   이미 받은 목록이 있으면 배경 재조회 실패는 신호가 아니다. 사진 GET 만 다시 부른다(메모의 records GET 은 안 건드린다).
 */
export function useVisitAttachments({
  tripId,
  visitCheckId,
}: {
  tripId: string;
  visitCheckId: string;
}) {
  const queryClient = useQueryClient();
  const key = getGetTripsTripIdVisitsVisitCheckIdPhotosQueryKey(
    tripId,
    visitCheckId
  );
  const query = useGetTripsTripIdVisitsVisitCheckIdPhotos(tripId, visitCheckId);
  const memo = useVisitMemo({ tripId, visitCheckId });
  const photoLoadFailed = failedUnlessNotFound(query);

  async function addPhoto(
    asset: PhotoAssetMeta,
    gpsConsent: boolean
  ): Promise<VisitPhoto> {
    const created = await postTripsTripIdVisitsVisitCheckIdPhotos(
      tripId,
      visitCheckId,
      photoAttach(asset, gpsConsent)
    );
    await queryClient.invalidateQueries({ queryKey: key });
    return created;
  }

  return {
    photos: query.data?.items ?? [],
    photoCount: query.data?.count ?? 0,
    isLoading: query.isLoading,
    photoLoadFailed,
    photoLoadRetrying: photoLoadFailed && query.isFetching,
    retryPhotoLoad: () => {
      void query.refetch();
    },
    addPhoto,
    ...memo,
  };
}
