import type { ReactElement } from 'react';
import { Pressable } from 'react-native';

import { HeartFilledGlyph, HeartOutlineGlyph } from './HeartGlyphs';

/**
 * 카드 사진 위 저장 하트(TRIP-1049) — Figma HeartButton `4462:1407`: 32 흰 원 + 18 하트.
 * 장소 카드(entities/place)와 홈 스팟 카드(features/home)가 함께 쓴다. 위치는 소비처가
 * `className` 으로 주고, 모양은 여기서 고정한다.
 *
 * 담김/안 담김은 색이 아니라 `accessibilityState.selected` + 서로 다른 글리프 testID 로 갈린다
 * (SVG fill 은 jest 사각). `pending` 이면 disabled 다 — 단 disabled 하트 press 는 부모
 * Pressable 로 새므로(RNTL Probe C) 누를 수 있는 카드는 자기 onPress 에 `!pending` 가드를 둔다.
 */
export interface HeartButtonProps {
  saved: boolean;
  pending?: boolean;
  onPress: () => void;
  testID: string;
  filledTestID: string;
  outlineTestID: string;
  className?: string;
}

export function HeartButton({
  saved,
  pending,
  onPress,
  testID,
  filledTestID,
  outlineTestID,
  className = '',
}: HeartButtonProps): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="담기"
      accessibilityState={{ selected: saved }}
      disabled={pending}
      onPress={onPress}
      className={`${className} h-8 w-8 items-center justify-center rounded-pill bg-on-primary`}
    >
      {saved ? (
        <HeartFilledGlyph testID={filledTestID} size={18} />
      ) : (
        <HeartOutlineGlyph testID={outlineTestID} size={18} />
      )}
    </Pressable>
  );
}
