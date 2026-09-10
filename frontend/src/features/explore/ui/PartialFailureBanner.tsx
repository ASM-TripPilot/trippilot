/**
 * d04 다지역 부분 실패 degraded 배너(TRIP-692 · INV-4 · ADR-0011). 성공한 지역 카드는 그대로
 * 두고(BR-U1-17 취지) 이 배너만 리스트 헤더에 얹힌다 — 컨테이너 자신은 Pressable 로 만들지
 * 않는다(누르면 본문까지 재시도가 눌리는 버블링 함정 방지, AC-7). `다시 시도` 만 실제
 * onRetry(=refetch)에 물린다(AC-6). features 경계상 stay 의 동명 배너를 import 하지 않고
 * explore 에 새로 그린다 — 아이콘만 explore `ExploreGlyphs.WarningTriangleGlyph` 재사용.
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { WarningTriangleGlyph } from './ExploreGlyphs';

export function PartialFailureBanner({
  onRetry,
}: {
  onRetry?: () => void;
}): ReactElement {
  return (
    <View
      testID="explore-places-partialfailure"
      className="flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-md py-sm"
    >
      <WarningTriangleGlyph size={20} tone="ink" />
      <Text className="flex-1 font-noto text-label text-body">
        일부 지역을 불러오지 못했어요
      </Text>
      <Pressable
        testID="explore-places-partialfailure-retry"
        accessibilityRole="button"
        onPress={onRetry}
      >
        <Text className="font-noto text-label text-primary">다시 시도</Text>
      </Pressable>
    </View>
  );
}
