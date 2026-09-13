import type { ReactElement, ReactNode } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { HeartFilledGlyph, HeartOutlineGlyph } from './PlaceGlyphs';

/**
 * TRIP-806 · AC-M2 — 썸네일 + 이름 + 부제 행 카드(중립 접두 자기 계약).
 *
 * testID 접두는 소비처가 `testIDPrefix` 로 주입한다. `save?` 를 주면 하트를 그린다 — 담김/미담김은
 * **서로 다른 글리프 testID**(`-heart-filled/outline-{id}`) + `accessibilityState.selected` 로 잰다
 * (색 토글 아님, 글리프 fill 함정 회피). `trailing?` 는 추가 버튼 등 오른쪽 슬롯. `imageUrl` null 이면
 * 회색 자리(INV-1). `subtitle` 은 ReactNode 슬롯(소비처가 지역·태그 or 메타 조립).
 */
export interface PlaceRowCardProps {
  testIDPrefix: string;
  id: string;
  name: string;
  imageUrl?: string | null;
  subtitle?: ReactNode;
  /** 저장 하트 — 있으면 `-remove-{id}` 하트 Pressable 을 그린다(없으면 하트 미렌더). */
  save?: { saved: boolean; onToggle: () => void };
  /** 오른쪽 슬롯(h13 추가 버튼 등). */
  trailing?: ReactNode;
}

export function PlaceRowCard({
  testIDPrefix,
  id,
  name,
  imageUrl,
  subtitle,
  save,
  trailing,
}: PlaceRowCardProps): ReactElement {
  return (
    <View
      testID={`${testIDPrefix}-${id}`}
      className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas p-md"
    >
      {imageUrl ? (
        <Image
          testID={`${testIDPrefix}-photo-${id}`}
          source={{ uri: imageUrl }}
          className="h-[64px] w-[64px] rounded-[12px]"
        />
      ) : (
        <View className="h-[64px] w-[64px] rounded-[12px] bg-surface-strong" />
      )}

      <View className="min-w-0 flex-1 gap-[4px]">
        <Text
          numberOfLines={1}
          className="font-noto-bold text-card-title font-bold text-ink"
        >
          {name}
        </Text>
        {subtitle}
      </View>

      {save ? (
        <Pressable
          testID={`${testIDPrefix}-remove-${id}`}
          accessibilityRole="button"
          accessibilityState={{ selected: save.saved }}
          onPress={save.onToggle}
          className="h-9 w-9 items-center justify-center rounded-pill"
        >
          {save.saved ? (
            <HeartFilledGlyph
              testID={`${testIDPrefix}-heart-filled-${id}`}
              size={22}
            />
          ) : (
            <HeartOutlineGlyph
              testID={`${testIDPrefix}-heart-outline-${id}`}
              size={22}
            />
          )}
        </Pressable>
      ) : null}

      {trailing}
    </View>
  );
}
