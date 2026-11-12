import type { AddPhotoRequest } from '@/shared/api/index.schemas';
import type { PhotoAssetMeta } from '@/shared/photo';

import { photoAttach } from './photoAttach';

/**
 * TRIP-1797 · 고른 사진을 **한 장씩 차례로** 등록한다 — 배치 API 가 없어 클라가 반복문으로 보낸다.
 *
 * 무엇을 보장하나:
 *  - 순차: 앞 장 요청이 끝나야 다음 장을 보낸다(서버 사진 순서 = 요청 순서). 장마다 요청 직전에 `onProgress(순번, 전체)`.
 *  - 한 장이 실패해도 다음 장을 계속 보내고, 성공/실패 자산을 입력 순서대로 나눠 돌려준다. 절대 throw 하지 않는다(INV-4 는 호출자가 안내로 드러낸다).
 *  - 위치 동의는 인자 하나로 전 장에 같게 적용된다(`photoAttach` — 꺼짐이면 좌표 키 자체가 없다).
 *
 * `post` 는 주입 함수(DI)라 네트워크 없이 순서를 잴 수 있다.
 */
export async function attachPhotosInOrder(
  assets: PhotoAssetMeta[],
  gpsConsent: boolean,
  post: (req: AddPhotoRequest) => Promise<unknown>,
  onProgress?: (current: number, total: number) => void
): Promise<{ succeeded: PhotoAssetMeta[]; failed: PhotoAssetMeta[] }> {
  const succeeded: PhotoAssetMeta[] = [];
  const failed: PhotoAssetMeta[] = [];
  for (const [index, asset] of assets.entries()) {
    onProgress?.(index + 1, assets.length);
    try {
      await post(photoAttach(asset, gpsConsent));
      succeeded.push(asset);
    } catch {
      failed.push(asset);
    }
  }
  return { succeeded, failed };
}
