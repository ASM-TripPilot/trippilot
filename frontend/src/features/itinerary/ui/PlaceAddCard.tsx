import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import type { Place } from '@/shared/api/generated/schemas';

import { PlusGlyph } from './ItineraryGlyphs';

/**
 * TRIP-338 · h20 장소 검색 결과 카드 — Figma `1894:1083`. 이미지 + 이름 + "#태그 · 카테고리" +
 * 추가/추가됨 버튼. `PoiSlotCard`(slotKey 키)·`SlotCandidateCard`(A/B/C 배지)는 1열+이미지+추가버튼
 * 레이아웃과 안 맞아 신규다(01b Q4).
 *
 * §8② 데이터 공백은 **그리지 않는다**: 거리("560m")는 `GET /places` 에 필드도 원점도 없고, 영업상태
 * ("영업중")는 `openingHours` 자유형 문자열이라 기계 판정 금지 — 둘 다 출처가 없어 카드에서 뺐다.
 * INV-1: `imageUrl` null 이면 회색 자리(기본 이미지를 지어내지 않는다 · TRIP-219).
 */

const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 2,
} as const;

export interface PlaceAddCardProps {
  place: Place;
  /** 이미 담긴 장소면 "추가됨"(비활성). */
  added: boolean;
  onPressAdd(): void;
}

export function PlaceAddCard({
  place,
  added,
  onPressAdd,
}: PlaceAddCardProps): ReactElement {
  // "#태그 · 카테고리" — 거리는 데이터 없음(§8②)이라 뺀다. 태그 없으면 카테고리만.
  const meta = [...place.tags.map((tag) => `#${tag}`), place.category].join(
    ' · '
  );

  return (
    <View
      testID={`itinerary-place-card-${place.poiId}`}
      style={cardShadow}
      className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas p-md"
    >
      {place.imageUrl ? (
        <Image
          source={{ uri: place.imageUrl }}
          className="h-[78px] w-[78px] rounded-[12px]"
        />
      ) : (
        <View className="h-[78px] w-[78px] rounded-[12px] bg-surface-strong" />
      )}

      <View className="min-w-0 flex-1 gap-[4px]">
        <Text
          className="font-noto-bold text-card-title font-bold text-ink"
          numberOfLines={1}
        >
          {place.nameKo}
        </Text>
        <Text className="font-noto text-[12.5px] text-muted" numberOfLines={1}>
          {meta}
        </Text>
      </View>

      {added ? (
        <View
          testID={`itinerary-place-added-${place.poiId}`}
          accessibilityState={{ disabled: true }}
          className="items-center justify-center rounded-button bg-surface-strong px-md py-sm"
        >
          <Text className="font-noto-bold text-label font-bold text-muted">
            추가됨
          </Text>
        </View>
      ) : (
        <Pressable
          testID={`itinerary-place-add-${place.poiId}`}
          accessibilityRole="button"
          onPress={onPressAdd}
          className="flex-row items-center gap-[3px] rounded-button bg-primary px-md py-sm"
        >
          <PlusGlyph size={14} tone="white" />
          <Text className="font-noto-bold text-label font-bold text-on-primary">
            추가
          </Text>
        </Pressable>
      )}
    </View>
  );
}
