import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';

import { guardPress } from '@/shared/lib/pressGuard';

/** 장소 상세의 "네이버 지도에서 보기" 버튼 — 눌림 가드만 얹은 얇은 틀(열기 판정은 호출부 몫). */
export function OpenNaverMapButton({
  testID,
  onPress,
}: {
  testID: string;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="네이버 지도에서 보기"
      onPress={guardPress(onPress)}
      className="h-[48px] items-center justify-center rounded-button border border-hairline bg-canvas"
    >
      <Text className="font-noto-bold text-label font-bold text-ink">
        네이버 지도에서 보기
      </Text>
    </Pressable>
  );
}
