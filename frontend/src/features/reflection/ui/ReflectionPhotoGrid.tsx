import type { ReactElement } from 'react';
import { Image, View } from 'react-native';

/**
 * TRIP-571 · 사진 그리드. testID `reflection-daily-photo-grid`.
 *
 * 무엇을 보장하나: 회고 하이라이트 사진들을 가로 그리드로 그린다. 사진 0장(hidePhotoGrid)일 때는
 * 화면이 이 그리드 대신 "사진 없음" 자리표시를 그리므로(BR-U5-34), 이 컴포넌트는 그려질 때 항상
 * 1장 이상을 전제한다(빈 배열이어도 컨테이너는 남아 testID 앵커가 유지된다).
 *
 * ★ 회고 계약(`Reflection`)에 사진 URL 배열이 없다 — 실제 사진 소스(방문 사진)는 후속 배선(01b 범위 밖).
 * 지금은 페이지가 넘긴 `photos` 만 그린다.
 */

export interface ReflectionPhotoGridProps {
  photos: { uri: string }[];
}

export function ReflectionPhotoGrid({
  photos,
}: ReflectionPhotoGridProps): ReactElement {
  return (
    <View
      testID="reflection-daily-photo-grid"
      className="w-full flex-row gap-sm"
    >
      {photos.map((photo, index) => (
        <Image
          key={`${photo.uri}-${index}`}
          source={{ uri: photo.uri }}
          className="h-[104px] flex-1 rounded-card bg-surface-soft"
          resizeMode="cover"
        />
      ))}
    </View>
  );
}
