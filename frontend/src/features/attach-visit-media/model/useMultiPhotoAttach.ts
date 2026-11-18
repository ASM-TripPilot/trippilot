import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  getGetTripsTripIdVisitsVisitCheckIdPhotosQueryKey,
  getTripsTripIdVisitsVisitCheckIdPhotos,
  postTripsTripIdVisitsVisitCheckIdPhotos,
} from '@/shared/api/index.hooks';
import type { PhotoAssetMeta } from '@/shared/photo';
import { showToast } from '@/shared/ui/Toast';
import { usePressLock } from '@/shared/lib/pressGuard';

import { attachPhotosInOrder } from './attachPhotosInOrder';
import {
  PHOTO_LIMIT_FULL_TEXT,
  PHOTO_SAVED_SINGLE_TEXT,
  photoFailedText,
  photoSavedText,
} from './photoBatchCopy';
import { pickPhotoForVisit } from './pickPhotoForVisit';
import { remainingPhotoSlots } from './visitPhotoLimit';

/**
 * TRIP-1797 · 방문에 사진 여러 장을 한 번에 붙이는 흐름 — j01 카드와 허브가 같은 규칙을 쓰는 한 곳.
 *
 * 무엇을 보장하나:
 *  - `attach(visitCheckId, knownCount?)` = 남은 칸(min(10, 30−현재))으로 피커 한도를 정하고 → 고르고 → 한 장씩 차례로 POST.
 *    현재 장수는 아는 쪽(j01)이 숫자로 주고, 모르는 쪽(허브)은 생략해 **이때 한 번** 조회한다(실패하면 10 — 서버 400 이 최후 가드).
 *    `null` 은 조회 없이 10. 남은 칸이 0 이면 피커를 열지 않고 안내만 한다.
 *  - 진행 중 재호출은 무시한다. 잠금은 ref 라 같은 틱의 두 번째 호출도 막는다(끝나면 — 취소·실패 포함 — 풀린다).
 *  - 일부 실패: 안내 `N장을 붙이지 못했어요`(번호 없어 빠진 장 포함) + `failed`(재시도 가능한 자산). `retry()` 는 그 장만 **처음 동의값**으로 다시 보낸다.
 *  - 전부 성공: 2장 이상이면 토스트 `사진 N장을 붙였어요`, 1장은 `singleSuccessToast` 일 때만 현행 문구. 사진 목록은 끝에서 한 번만 다시 받는다.
 */
export interface MultiPhotoNotice {
  visitCheckId: string;
  text: string;
  /** 권한이 원인이라 설정에서만 풀리는 안내 — 부르는 쪽이 [설정 열기] 를 옆에 그린다. */
  settings: boolean;
}

export function useMultiPhotoAttach({
  tripId,
  toastTestID,
  singleSuccessToast = false,
}: {
  tripId: string;
  toastTestID: string;
  singleSuccessToast?: boolean;
}) {
  const queryClient = useQueryClient();
  const lock = usePressLock();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    visitCheckId: string;
    current: number;
    total: number;
  } | null>(null);
  const [notice, setNotice] = useState<MultiPhotoNotice | null>(null);
  const [failed, setFailed] = useState<{
    visitCheckId: string;
    localAssetIds: string[];
  } | null>(null);
  // 재시도가 처음 동의값·같은 자산 메타를 쓰도록 쥔다(렌더에 안 쓰므로 ref).
  const retryContext = useRef<{
    visitCheckId: string;
    gpsConsent: boolean;
    assets: PhotoAssetMeta[];
    skipped: number;
  } | null>(null);

  /** 한 번의 시도(고른 뒤 또는 재시도)를 돌리고 실패 자산을 돌려준다 — 목록 재조회는 끝에서 한 번. */
  const run = async (
    visitCheckId: string,
    assets: PhotoAssetMeta[],
    gpsConsent: boolean
  ) => {
    const result = await attachPhotosInOrder(
      assets,
      gpsConsent,
      (req) =>
        postTripsTripIdVisitsVisitCheckIdPhotos(tripId, visitCheckId, req),
      (current, total) => setProgress({ visitCheckId, current, total })
    );
    await queryClient.invalidateQueries({
      queryKey: getGetTripsTripIdVisitsVisitCheckIdPhotosQueryKey(
        tripId,
        visitCheckId
      ),
    });
    return result;
  };

  const showResult = (
    visitCheckId: string,
    failedAssets: PhotoAssetMeta[],
    skipped: number
  ) => {
    const failedCount = failedAssets.length + skipped;
    setNotice(
      failedCount > 0
        ? {
            visitCheckId,
            text: photoFailedText(failedCount),
            settings: false,
          }
        : null
    );
    setFailed(
      failedAssets.length > 0
        ? {
            visitCheckId,
            localAssetIds: failedAssets.map((a) => a.localAssetId),
          }
        : null
    );
  };

  const attach = async (
    visitCheckId: string,
    knownCount?: number | null
  ): Promise<void> => {
    if (!lock.acquire()) return;
    setBusy(true);
    setNotice(null);
    setFailed(null);
    try {
      const count =
        knownCount === undefined
          ? await getTripsTripIdVisitsVisitCheckIdPhotos(
              tripId,
              visitCheckId
            ).then(
              (list) => list.count,
              () => null
            )
          : knownCount;
      const limit = remainingPhotoSlots(count);
      if (limit === 0) {
        setNotice({
          visitCheckId,
          text: PHOTO_LIMIT_FULL_TEXT,
          settings: false,
        });
        return;
      }
      const picked = await pickPhotoForVisit({ limit });
      if ('notice' in picked) {
        // 취소는 notice null — 조용히 둔다.
        if (picked.notice !== null) {
          setNotice({
            visitCheckId,
            text: picked.notice,
            settings: picked.settings === true,
          });
        }
        return;
      }
      const { assets, skipped, gpsConsent } = picked;
      const result = await run(visitCheckId, assets, gpsConsent);
      retryContext.current = { visitCheckId, gpsConsent, assets, skipped };
      showResult(visitCheckId, result.failed, skipped);
      if (result.failed.length + skipped === 0) {
        const n = result.succeeded.length;
        if (n >= 2)
          showToast({ message: photoSavedText(n), testID: toastTestID });
        else if (n === 1 && singleSuccessToast)
          showToast({ message: PHOTO_SAVED_SINGLE_TEXT, testID: toastTestID });
      }
    } finally {
      lock.release();
      setBusy(false);
      setProgress(null);
    }
  };

  const retry = async (): Promise<void> => {
    const context = retryContext.current;
    if (context === null || failed === null || !lock.acquire()) return;
    setBusy(true);
    try {
      const retryable = context.assets.filter((a) =>
        failed.localAssetIds.includes(a.localAssetId)
      );
      const result = await run(
        context.visitCheckId,
        retryable,
        context.gpsConsent
      );
      showResult(context.visitCheckId, result.failed, context.skipped);
    } finally {
      lock.release();
      setBusy(false);
      setProgress(null);
    }
  };

  return { attach, retry, busy, progress, notice, failed };
}
