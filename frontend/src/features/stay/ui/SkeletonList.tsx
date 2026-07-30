/**
 * `loading` 전용(01b Seed §3-1 · Q11). 신 default 카드(세로형 — 사진 위 178px + 텍스트)를
 * 그대로 재해석해 회색 블록 2장으로 접어 그린다(구 세대 Figma 프레임은 가로형 4장이지만,
 * 정본 Q14=A가 레이아웃은 신 default 기준으로 재해석하라고 정했다).
 */
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

function SkeletonCard({ index }: { index: number }): ReactElement {
  return (
    <View testID={`stay-search-skeleton-${index}`} className="w-full gap-sm">
      <View className="h-[178px] w-full rounded-card bg-surface-strong" />
      <View className="gap-xs">
        <View className="h-[14px] w-2/3 rounded-[6px] bg-hairline" />
        <View className="h-[12px] w-1/2 rounded-[6px] bg-surface-strong" />
        <View className="h-[16px] w-1/3 rounded-[6px] bg-surface-strong" />
      </View>
    </View>
  );
}

export function SkeletonList(): ReactElement {
  return (
    <View testID="stay-search-loading" className="w-full gap-lg px-lg pt-lg">
      <Text className="font-noto text-label text-muted-soft">
        숙소를 모으는 중
      </Text>
      <View className="gap-lg">
        <SkeletonCard index={0} />
        <SkeletonCard index={1} />
      </View>
    </View>
  );
}
