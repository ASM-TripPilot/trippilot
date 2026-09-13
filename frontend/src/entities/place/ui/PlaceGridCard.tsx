import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import type { Place } from '../model';

import {
  HeartBadgeGlyph,
  HeartFilledGlyph,
  HeartOutlineGlyph,
} from './PlaceGlyphs';
import { PlaceSubtitle } from './PlaceSubtitle';

/**
 * TRIP-806 · AC-M2·M4 — d04 장소 탐색 2열 그리드 카드(explore 단일 소비라 testID 하드코딩, ★14).
 *
 * 담김/미담김은 색이 아니라 저장 하트의 `accessibilityState.selected` + 서로 다른 글리프로 잰다
 * (글리프 fill 함정 회피). 담기면 "담음" 배지가 함께 뜬다. pending 이면 하트 disabled(연타 가드).
 * `imageUrl` null 이면 사진 leaf 를 안 그린다(회색 자리 · INV-1). 부제는 `카테고리 · 지역`(지역 없으면
 * 카테고리만).
 */
export interface PlaceGridCardProps {
  place: Place;
  saved: boolean;
  pending: boolean;
  onToggleSave: (place: Place) => void;
  /** 카드 본문 탭 → d06 상세. pending 하트 press 가 부모로 새는 것을 가드(Probe C). */
  onPressCard?: (place: Place) => void;
}

export function PlaceGridCard({
  place,
  saved,
  pending,
  onToggleSave,
  onPressCard,
}: PlaceGridCardProps): ReactElement {
  const subtitleParts = place.region
    ? [place.category, place.region]
    : [place.category];

  return (
    // bare Pressable(accessibilityRole 없음) — role 을 붙이면 d04 `states.test.tsx` 의
    // role=button 개수 동결(정확히 15)이 깨진다(★1). `!pending` 가드: 대기(disabled) 하트 press 는
    // 부모 Pressable 로 새는데(RNTL Probe C), pending 이면 카드 이동을 무효화해 그 누수를 막는다.
    <Pressable
      testID={`explore-places-card-${place.poiId}`}
      onPress={() => {
        if (!pending) onPressCard?.(place);
      }}
      className="w-[48%] gap-[7px]"
    >
      <View className="h-[132px] w-full overflow-hidden rounded-[14px] bg-surface-soft">
        {place.imageUrl ? (
          <Image
            source={{ uri: place.imageUrl }}
            resizeMode="cover"
            className="h-full w-full"
          />
        ) : null}
        {saved ? (
          <View className="absolute left-sm top-sm flex-row items-center gap-xs rounded-pill bg-primary pb-[5px] pl-[9px] pr-[11px] pt-[5px]">
            <HeartBadgeGlyph size={12} />
            <Text className="font-noto-bold text-micro font-bold text-on-primary">
              담음
            </Text>
          </View>
        ) : null}
        <Pressable
          testID={`explore-places-save-${place.poiId}`}
          accessibilityRole="button"
          accessibilityState={{ selected: saved }}
          disabled={pending}
          onPress={() => onToggleSave(place)}
          className="absolute right-sm top-sm h-8 w-8 items-center justify-center rounded-pill bg-on-primary"
        >
          {saved ? (
            <HeartFilledGlyph size={18} />
          ) : (
            <HeartOutlineGlyph size={18} />
          )}
        </Pressable>
      </View>
      <Text className="font-noto-bold text-[13.5px] font-bold text-ink">
        {place.nameKo}
      </Text>
      <PlaceSubtitle
        parts={subtitleParts}
        className="font-noto text-[11.5px] text-muted"
      />
    </Pressable>
  );
}
