import { useState } from 'react';

import { placeCoverSource } from '@/shared/lib/placeCover';

/**
 * 장소 사진 칸의 "서버 사진 vs 번들 표지" 상태. `PlacePhoto`·`PoiPhoto` 가 함께 쓴다.
 * 불리언이 아니라 실패한 URL 문자열을 기억한다 — 리스트 재활용으로 같은 칸에 다른 URL 이 오면 실패가 따라붙지 않는다.
 */
export function usePlacePhotoSource(
  imageUrl: string | null | undefined,
  category: string | null | undefined,
  poiId: string | null | undefined
) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasServerPhoto =
    typeof imageUrl === 'string' &&
    imageUrl.trim() !== '' &&
    imageUrl !== failedUrl;

  return {
    hasServerPhoto,
    source: hasServerPhoto
      ? { uri: imageUrl }
      : placeCoverSource(category, poiId),
    onError: () => setFailedUrl(imageUrl ?? null),
  };
}
