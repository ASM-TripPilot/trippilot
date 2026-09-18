/**
 * partial-failure 배너(01b Seed §3-4 · 정본이 이름·testID까지 지정). 결과 카드는 그대로 두고
 * (BR-U1-17), 이 배너만 `ListHeaderComponent` 안에 얹힌다 — 배너 컨테이너 자신은 Pressable로
 * 만들지 않는다(누르면 본문까지 재시도가 눌리는 함정 방지, §5 ★7). `다시 시도`만 실제
 * `onRetry`(=`refetch`)에 물린다(Q8).
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { WarningTriangleGlyph } from './StayGlyphs';

export function PartialFailureBanner({
  onRetry,
}: {
  onRetry?: () => void;
}): ReactElement {
  return (
    <View
      testID="stay-search-partialfailure"
      className="w-full flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-md py-sm"
    >
      <WarningTriangleGlyph size={20} tone="ink" />
      <Text className="flex-1 font-noto text-label text-body">
        일부 숙소 정보를 불러오지 못했어요
      </Text>
      <Pressable
        testID="stay-search-partialfailure-retry"
        accessibilityRole="button"
        onPress={onRetry}
      >
        <Text className="font-noto-bold text-label font-bold text-primary">
          다시 시도
        </Text>
      </Pressable>
    </View>
  );
}
