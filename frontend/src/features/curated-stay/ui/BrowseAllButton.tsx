import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';

/** 「Trip.com에서 전체 숙소 보기」 윤곽 버튼(TRIP-1579) — 누름은 소비처가 제휴 흐름으로 잇는다. */
export function BrowseAllButton({
  onPress,
}: {
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      testID="curated-stay-browse-all"
      accessibilityRole="button"
      onPress={onPress}
      className="h-[50px] w-full items-center justify-center rounded-button border border-hairline-strong bg-canvas"
    >
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        Trip.com에서 전체 숙소 보기
      </Text>
    </Pressable>
  );
}
