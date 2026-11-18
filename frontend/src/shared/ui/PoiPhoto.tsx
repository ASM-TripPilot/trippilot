import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ImageLicense } from '@/shared/api/index.schemas';
import { PHOTO_CREDIT, resolvePhotoPolicy } from '@/shared/lib/photoLicense';
import { usePlacePhotoSource } from '@/shared/lib/usePlacePhotoSource';

import { Image } from './Image';

type PoiPhotoProps = Omit<
  ComponentProps<typeof Image>,
  'source' | 'onError' | 'contentFit'
> & {
  imageUrl?: string | null;
  /** 필수 — 값이 끊기면 `pnpm tsc` 가 잡는다. null·undefined(유형 미수집)는 자르지 않는다. */
  imageLicense: ImageLicense | null | undefined;
  category?: string | null;
  poiId?: string | null;
  /** 칸 배경(남는 여백)과 출처 글자 모양: overlay=어두운 여백·긴 문구(흰 글자가 얹히는 큰 카드), card=연회색·긴 문구, thumb=연회색·짧은 문구(작은 칸). */
  surface: 'overlay' | 'card' | 'thumb';
};

const SURFACE_BG = {
  overlay: 'bg-ink',
  card: 'bg-surface-strong',
  thumb: 'bg-surface-strong',
} as const;

/**
 * 관광공사 서버 POI 사진 전용 부품(TRIP-1740) — 공공누리 이용 조건대로 3유형(변경금지)은 자르지 않고,
 * 서버 사진에는 출처 글자를 단다. 판정은 `resolvePhotoPolicy` 한 곳이고 호출부는 `contentFit` 을 줄 수 없다.
 * 번들 표지·로드 실패일 때는 `cover` + 출처 없음. `PlacePhoto` 를 감싸지 않는 이유: 로드 실패 상태가 안에 갇혀
 * 실패 뒤에도 contain·출처가 남기 때문이다(상태는 `usePlacePhotoSource` 로 공유).
 * 칸 모양(`className`·`style`)과 배경은 바깥 View, 사진 노드(`testID`)는 그 안을 채운다.
 */
export function PoiPhoto({
  imageUrl,
  imageLicense,
  category,
  poiId,
  surface,
  className,
  style,
  testID,
  ...rest
}: PoiPhotoProps) {
  const { source, hasServerPhoto, onError } = usePlacePhotoSource(
    imageUrl,
    category,
    poiId
  );
  const policy = resolvePhotoPolicy({ imageLicense, hasServerPhoto });
  const small = surface === 'thumb';

  return (
    <View
      className={`overflow-hidden ${SURFACE_BG[surface]} ${className ?? ''}`}
      style={style}
    >
      <Image
        {...rest}
        testID={testID}
        style={StyleSheet.absoluteFill}
        source={source}
        contentFit={policy.fit}
        onError={onError}
      />
      {policy.showCredit ? (
        <Text
          testID={testID ? `${testID}-credit` : undefined}
          accessibilityLabel={PHOTO_CREDIT.a11y}
          numberOfLines={1}
          adjustsFontSizeToFit={small}
          allowFontScaling={false}
          className={
            small
              ? 'absolute bottom-0 left-0 right-0 bg-scrim/40 px-1 text-center text-micro text-on-primary'
              : 'absolute bottom-1 right-1 rounded-pill bg-scrim/40 px-1.5 py-0.5 text-micro text-on-primary'
          }
        >
          {small ? PHOTO_CREDIT.short : PHOTO_CREDIT.full}
        </Text>
      ) : null}
    </View>
  );
}
