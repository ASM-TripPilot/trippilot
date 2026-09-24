import { useState } from 'react';
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
 *
 * TRIP-760 · 업로드 실패는 **이 훅**에 둔다(컨테이너 로컬 아님 — 훅이 이미 POST·무효화를 소유). 신설 3멤버:
 *  - `attachPhoto` = addPhoto 를 try/catch 로 감싼 **non-throw** 판(실패를 reject 대신 `failedUploads` 상태로
 *    노출 → fire-and-forget 호출자가 unhandled rejection 을 안 낸다). 기존 `addPhoto`(reject-on-fail)는 무변경.
 *  - `failedUploads` = 실패로 노출 중인 자산 목록(재시도 대상). 성공하면 그 자산이 목록에서 빠진다.
 *  - `retryUpload(localAssetId)` = 저장해 둔 자산·동의로 같은 POST 를 다시 부른다(재실패=재노출, 중복 없음).
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

  // 실패로 노출 중인 자산 — 재시도가 같은 POST 를 다시 부를 수 있게 자산 메타·동의를 함께 쥔다.
  const [failures, setFailures] = useState<
    { asset: PhotoAssetMeta; gpsConsent: boolean }[]
  >([]);

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

  // addPhoto(POST + 무효화)를 재사용하되 reject 를 삼켜 상태로 바꾼다. 성공 → 실패 목록에서 제거,
  // 실패 → 같은 자산 추가(같은 localAssetId 는 중복 push 금지 = 재실패=재노출).
  async function attachPhoto(
    asset: PhotoAssetMeta,
    gpsConsent: boolean
  ): Promise<void> {
    try {
      await addPhoto(asset, gpsConsent);
      setFailures((prev) =>
        prev.filter((f) => f.asset.localAssetId !== asset.localAssetId)
      );
    } catch {
      setFailures((prev) =>
        prev.some((f) => f.asset.localAssetId === asset.localAssetId)
          ? prev
          : [...prev, { asset, gpsConsent }]
      );
    }
  }

  async function retryUpload(localAssetId: string): Promise<void> {
    const failed = failures.find((f) => f.asset.localAssetId === localAssetId);
    if (failed == null) return;
    await attachPhoto(failed.asset, failed.gpsConsent);
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
    attachPhoto,
    failedUploads: failures.map((f) => ({
      localAssetId: f.asset.localAssetId,
    })),
    retryUpload,
    saveMemo,
  };
}
