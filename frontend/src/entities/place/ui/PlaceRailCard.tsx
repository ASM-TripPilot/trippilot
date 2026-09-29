import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import type { PlaceCardVM } from '../model';

import { HeartButton } from '@/shared/ui/HeartButton';

/**
 * TRIP-806 · AC-M2·M4 — d01 탐색 랜딩의 "가볼 곳" 레인 카드(160폭)·d05 목적지 상세의 장소 격자
 * 칸 카드(`variant="fill"`, TRIP-1048).
 *
 * 사진은 `imageUrl` 있을 때만 그린다 — 없으면 회색 자리(기본 이미지 발명 금지 · INV-1). 카드 press →
 * `onPress(poiId)`.
 *
 * testID 스킴은 소비처가 `testIDPrefix` 로 주입한다(기본 `explore-place-card` = d01). d05 는
 * `destination-detail-place-card` 를 주입해 자기 무수정 테스트의 testID 를 그대로 재현한다.
 */
export interface PlaceRailCardProps {
  card: PlaceCardVM;
  onPress: (poiId: string) => void;
  /** 루트/이미지 testID 접두(기본 d01 스킴). */
  testIDPrefix?: string;
  /** 폭: 'rail'(기본) = 160 고정 · 'fill' = 부모 칸을 채운다(d05 2열 격자, TRIP-1048). */
  variant?: 'rail' | 'fill';
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
  testIDPrefix = 'explore-place-card',
  variant = 'rail',
  save,
}: PlaceRailCardProps): ReactElement {
  return (
    // `!pending` 가드: 대기(disabled) 하트 press 는 부모 카드로 샌다(RNTL Probe C) — PlaceGridCard 선례.
    <Pressable
      testID={`${testIDPrefix}-${card.poiId}`}
      accessibilityRole="button"
      onPress={() => {
        if (!save?.pending) onPress(card.poiId);
      }}
      className={variant === 'fill' ? 'w-full' : 'w-[160px]'}
    >
      <View>
        {card.imageUrl ? (
          <Image
            testID={`${testIDPrefix}-image-${card.poiId}`}
            source={{ uri: card.imageUrl }}
            resizeMode="cover"
            className="h-[110px] w-full rounded-card bg-surface-strong"
          />
        ) : (
          <View className="h-[110px] w-full rounded-card bg-surface-strong" />
        )}
        {save ? (
          <HeartButton
            saved={save.saved}
            pending={save.pending}
            onPress={save.onToggle}
            testID={save.testID}
            filledTestID={save.filledTestID}
            outlineTestID={save.outlineTestID}
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
