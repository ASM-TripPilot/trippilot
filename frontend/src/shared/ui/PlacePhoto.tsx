import type { ComponentProps } from 'react';

import { usePlacePhotoSource } from '@/shared/lib/usePlacePhotoSource';

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
 * 관광공사 서버 사진(이용 조건: 3유형 안 자름·출처)은 이 부품이 아니라 `PoiPhoto` 로 그린다 — 이 부품은 기기 사진·번들 표지용.
 */
export function PlacePhoto({
  imageUrl,
  category,
  poiId,
  ...rest
}: PlacePhotoProps) {
  const { source, onError } = usePlacePhotoSource(imageUrl, category, poiId);

  return <Image {...rest} source={source} onError={onError} />;
}
