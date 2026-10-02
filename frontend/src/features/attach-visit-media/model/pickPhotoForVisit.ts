import { getMeLocationConsent } from '@/shared/api/index.hooks';
import { pickPhotoAsset, type PhotoAssetMeta } from '@/shared/photo';

/**
 * TRIP-1070 · 방문에 붙일 사진 1장 고르기 — 허브 [사진]과 j01 `+` 가 함께 쓴다.
 *
 * 무엇을 보장하나:
 *  - 골랐으면 `{ asset, gpsConsent }` — 위치 동의는 **고른 뒤에** 한 번 읽는다(보기만 한 화면에서
 *    요청하지 않는다). 서버 `gpsRecordingOptIn`(L3, BR-U5-12)만 보고, 조회 실패는 끈 것으로 본다
 *    (좌표만 빠질 뿐 첨부는 막지 않는다).
 *  - 못 골랐으면 `{ notice }` — 취소는 null(사용자 의도라 조용히), 나머지는 사용자에게 보일 안내 한 줄
 *    (INV-4 · US-REC-02 예외). 성공 전용 Toast 가 아니라 부르는 쪽이 트리거 옆에 그린다.
 */

export type PhotoPickOutcome =
  { asset: PhotoAssetMeta; gpsConsent: boolean } | { notice: string | null };

const PICK_NOTICE = {
  canceled: null,
  denied: '사진 접근 권한이 없어 사진을 불러올 수 없어요',
  'no-asset-id':
    '선택한 사진을 불러올 수 없어요. 사진 전체 접근을 허용해 주세요',
  failed: '사진을 불러올 수 없어요',
} as const;

export async function pickPhotoForVisit(): Promise<PhotoPickOutcome> {
  const result = await pickPhotoAsset();
  if (result.kind !== 'picked') return { notice: PICK_NOTICE[result.kind] };
  const gpsConsent = await getMeLocationConsent().then(
    (consent) => consent.gpsRecordingOptIn === true,
    () => false
  );
  return { asset: result.asset, gpsConsent };
}
