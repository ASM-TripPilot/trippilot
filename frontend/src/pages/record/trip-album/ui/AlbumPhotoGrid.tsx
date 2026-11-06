import type { ReactElement } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { Image } from '@/shared/ui/Image';

/**
 * TRIP-1798 · 앨범 3열 격자 — 칸은 정사각, 폭이 달라도 3분할을 유지하고 마지막 줄이 1~2장이어도 칸을 늘리지 않는다.
 * 390 폭이면 (390 − 좌우 16×2 − 간격 8×2) / 3 = 114. 사진은 눌리지 않는다(확대 뷰어는 범위 밖, TRIP-1798 Q8).
 * 셀 testID `trip-album-photo-{visitPhotoMetaId}` 는 Image 노드 자체에 단다(주소는 `source.uri`).
 */

const SIDE = 16;
const GAP = 8;

export function AlbumPhotoGrid({
  photos,
}: {
  photos: readonly { visitPhotoMetaId: string; uri: string }[];
}): ReactElement {
  const { width } = useWindowDimensions();
  const size = Math.floor((width - SIDE * 2 - GAP * 2) / 3);

  return (
    <View className="flex-row flex-wrap gap-sm">
      {photos.map((photo) => (
        <Image
          key={photo.visitPhotoMetaId}
          testID={`trip-album-photo-${photo.visitPhotoMetaId}`}
          source={{ uri: photo.uri }}
          style={{ width: size, height: size }}
          className="rounded-thumb bg-surface-soft"
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ))}
    </View>
  );
}
