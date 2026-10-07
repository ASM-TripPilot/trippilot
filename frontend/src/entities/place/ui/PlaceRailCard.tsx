import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import type { PlaceCardVM } from '../model';

import { HeartButton } from '@/shared/ui/HeartButton';

/**
 * TRIP-806 · AC-M2·M4 — d01 탐색 랜딩의 "가볼 곳" 레인 카드(160폭 · 사진 160×120, 숙소 rail 카드와
 * 같은 폭 — TRIP-1105 QA #7).
 *
 * 사진은 `imageUrl` 있을 때만 그린다 — 없으면 회색 자리(기본 이미지 발명 금지 · INV-1). 카드 press →
 * `onPress(poiId)`.
 *
 * testID 는 d01 스킴(`explore-place-card-{poiId}`) 고정이다 — 다른 접두를 주입하던 d05 목적지 상세가
 * TRIP-1105 로 사라졌다.
 */
export interface PlaceRailCardProps {
  card: PlaceCardVM;
  onPress: (poiId: string) => void;
  /** 저장 하트(TRIP-1049, 옵셔널) — 미지정이면 하트를 안 그린다. testID 는 소비처가 완성 문자열로 준다. */
  save?: PlaceRailCardSave;
}

export interface PlaceRailCardSave {
  saved: boolean;
  pending?: boolean;
  onToggle: () => void;
  testID: string;
  filledTestID: string;
  outlineTestID: string;
}

export function PlaceRailCard({
  card,
  onPress,
  save,
}: PlaceRailCardProps): ReactElement {
  return (
    // `!pending` 가드: 대기(disabled) 하트 press 는 부모 카드로 샌다(RNTL Probe C) — PlaceGridCard 선례.
    <Pressable
      testID={`explore-place-card-${card.poiId}`}
      accessibilityRole="button"
      // 보이는 글자 그대로(TRIP-1281) — 없으면 iOS 가 자식 하트 라벨을 카드에 끌어다 붙인다.
      accessibilityLabel={[card.name, card.region].filter(Boolean).join(', ')}
      onPress={() => {
        if (!save?.pending) onPress(card.poiId);
      }}
      className="w-[160px]"
    >
      <View>
        {card.imageUrl ? (
          <Image
            testID={`explore-place-card-image-${card.poiId}`}
            source={{ uri: card.imageUrl }}
            resizeMode="cover"
            className="h-[120px] w-full rounded-card bg-surface-strong"
          />
        ) : (
          <View className="h-[120px] w-full rounded-card bg-surface-strong" />
        )}
        {save ? (
          <HeartButton
            saved={save.saved}
            pending={save.pending}
            onPress={save.onToggle}
            testID={save.testID}
            filledTestID={save.filledTestID}
            outlineTestID={save.outlineTestID}
            name={card.name}
            className="absolute right-sm top-sm"
          />
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        className="mt-sm font-noto-bold text-card-title font-bold text-ink"
      >
        {card.name}
      </Text>
      <Text numberOfLines={1} className="mt-xs font-noto text-label text-muted">
        {card.region}
      </Text>
    </Pressable>
  );
}
