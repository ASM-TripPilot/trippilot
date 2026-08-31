import type { AddPhotoRequest } from '@/shared/api/generated/schemas';
import type { PhotoAssetMeta } from '@/shared/photo';

export type { PhotoAssetMeta };

/**
 * TRIP-566 · AC-2 · PBT-U5-F3 · INV-U5-04 · BR-U5-12 — 로컬 자산 메타를 서버 등록 메타로 조립한다.
 *
 * 무엇을 보장하나:
 *  - 서버로 가는 것은 **메타만**(localAssetId·deviceId·촬영시각·정렬·EXIF[동의 시]) — 바이너리/storage_key
 *    는 `AddPhotoRequest` 계약에 자리가 없어 구조적으로 봉쇄된다(INV-U5-03).
 *  - 위치 동의(`gpsConsent`)가 없으면 EXIF 좌표 키 자체를 안 싣는다(undefined 로도 안 보낸다) — 동의가
 *    있어도 자산에 좌표가 없으면 키를 만들지 않는다.
 *
 * ★ 순수 함수 — 동의를 직접 안 읽고 **plain boolean 을 인자로** 받는다(DI). 그래서 expo 타입/모듈을
 *   import 하지 않는다(하면 tsc/jest 가 깨진다). 배선 훅이 `useLocationConsent().consentOn` 을 넘긴다.
 */
export function photoAttach(
  asset: PhotoAssetMeta,
  gpsConsent: boolean
): AddPhotoRequest {
  const req: AddPhotoRequest = {
    localAssetId: asset.localAssetId,
    deviceId: asset.deviceId,
  };
  if (asset.takenAt !== undefined) req.takenAt = asset.takenAt;
  if (asset.sortOrder !== undefined) req.sortOrder = asset.sortOrder;
  // 동의 없으면(또는 좌표 부재) exif 키를 만들지 않는다 — 키가 있으면 not.toHaveProperty 가 red.
  if (gpsConsent && asset.exifLat !== undefined) req.exifLat = asset.exifLat;
  if (gpsConsent && asset.exifLng !== undefined) req.exifLng = asset.exifLng;
  return req;
}
