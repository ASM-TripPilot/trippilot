import { useQueryClient } from '@tanstack/react-query';

import {
  getGetTripsTripIdVisitsVisitCheckIdPhotosQueryKey,
  postTripsTripIdVisitsVisitCheckIdPhotos,
  putTripsTripIdVisitsVisitCheckIdMemo,
  useGetTripsTripIdVisitsVisitCheckIdPhotos,
} from '@/shared/api/generated/trips/trips';
import type { VisitPhoto } from '@/shared/api/generated/schemas';

import { photoAttach, type PhotoAssetMeta } from './photoAttach';

/**
 * TRIP-566 · AC-5 · BR-U5-13 — 방문 첨부 배선 훅(사진 GET/POST · 메모 PUT upsert).
 *
 * 무엇을 보장하나:
 *  - GET photos 의 items/count 를 그대로 노출한다(다건).
 *  - `addPhoto` = `photoAttach`(동의 게이트) → POST photos → 성공 시 photos 쿼리 무효화(재조회로 목록 성장).
 *  - `saveMemo` = 공백만이면 **PUT 0회**(무의미 upsert 방지), 아니면 PUT memo(만들기/고치기 안 나눔).
 *
 * ★ 새 HTTP 함수를 만들지 않는다(recordsStructure G5) — 생성 클라이언트의 3함수만 재사용한다.
 *   동의 게이트는 순수 함수 `photoAttach` 가 지므로 이 훅은 gpsConsent 를 그대로 통과시킨다.
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

  async function saveMemo(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === '') return;
    await putTripsTripIdVisitsVisitCheckIdMemo(tripId, visitCheckId, {
      text: trimmed,
    });
  }

  return {
    photos: query.data?.items ?? [],
    photoCount: query.data?.count ?? 0,
    isLoading: query.isLoading,
    addPhoto,
    saveMemo,
  };
}
