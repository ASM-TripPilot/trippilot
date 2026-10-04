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
 *  - TRIP-1216 · 앱이 스스로 못 푸는 사유(권한 거부)는 `settings: true` 를 함께 준다 — 부르는 쪽이 안내 옆에
 *    [설정 열기](`Linking.openSettings`)를 그린다. 그 밖의 사유엔 키 자체가 없다.
 */

export type PhotoPickOutcome =
  | { asset: PhotoAssetMeta; gpsConsent: boolean }
  | { notice: string | null; settings?: true };

const PICK_NOTICE = {
  canceled: null,
  denied: '사진 접근 권한이 없어 사진을 불러올 수 없어요',
  limited:
    '사진 접근이 "선택한 사진만"으로 제한돼 있어요. 설정에서 모든 사진 접근을 허용해 주세요',
  'no-asset-id':
    '선택한 사진을 불러올 수 없어요. 사진 전체 접근을 허용해 주세요',
  failed: '사진을 불러올 수 없어요',
} as const;

export async function pickPhotoForVisit(): Promise<PhotoPickOutcome> {
  const result = await pickPhotoAsset();
  if (result.kind !== 'picked') {
    const notice = PICK_NOTICE[result.kind];
    // 권한이 원인인 사유(거부·제한·자산 번호 없음)는 설정에서만 풀린다 — 재시도 대신 설정으로 보낸다.
    return result.kind === 'denied' ||
      result.kind === 'limited' ||
      result.kind === 'no-asset-id'
      ? { notice, settings: true }
      : { notice };
  }
  const gpsConsent = await getMeLocationConsent().then(
    (consent) => consent.gpsRecordingOptIn === true,
    () => false
  );
  return { asset: result.asset, gpsConsent };
}
