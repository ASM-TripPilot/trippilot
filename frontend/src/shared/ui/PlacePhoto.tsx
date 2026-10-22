import { type ComponentProps, useState } from 'react';

import { placeCoverSource } from '@/shared/lib/placeCover';

import { Image } from './Image';

type PlacePhotoProps = Omit<
  ComponentProps<typeof Image>,
  'source' | 'onError'
> & {
  imageUrl?: string | null;
  category?: string | null;
  poiId?: string | null;
};

/**
 * 장소 사진 칸 공용 부품. 서버 사진이 있으면 그 사진, 없거나(null·''·공백만) 로드가 실패하면
 * 카테고리 생성 이미지(`placeCoverSource`)를 그린다. 호출부는 `imageUrl ? … : …` 분기를 두지 않고 이것 하나를 쓴다.
 */
export function PlacePhoto({
  imageUrl,
  category,
  poiId,
  ...rest
}: PlacePhotoProps) {
  // 불리언이 아니라 실패한 URL 문자열을 기억한다 — 리스트 재활용으로 같은 칸에 다른 URL 이 오면 실패가 따라붙지 않는다.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasServerPhoto =
    typeof imageUrl === 'string' &&
    imageUrl.trim() !== '' &&
    imageUrl !== failedUrl;

  return (
    <Image
      {...rest}
      source={
        hasServerPhoto ? { uri: imageUrl } : placeCoverSource(category, poiId)
      }
      onError={() => setFailedUrl(imageUrl ?? null)}
    />
  );
}
