/**
 * `loading` 전용(01b Seed §3-1 · Q11 · TRIP-726 AC-L1′). 신 default 카드(세로형 — 사진 위
 * 178px + 텍스트)를 회색 블록으로 접어 그리되, 각 장을 흰 카드 틀(border-hairline + soft
 * shadow + rounded-card)로 감싼 세로형 4장이다. 라이브 Figma(1340:1312)는 가로형 4장이지만,
 * 01b 오케 판정이 Q14=A(레이아웃은 신 default=세로 재해석)를 유지하기로 확정했다(방향 전환
 * 없이 카드 틀 + 2→4장만) — 가로형 정합은 Figma 수정(TRIP-815 후보)으로 미룬다.
 */
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

// 카드 틀 소프트 그림자(Figma 0 2 10 rgba(0,0,0,0.06)) — className 으로 못 줘 style prop 으로
// 옮긴다. shadowColor '#000000' 은 토큰화 대상 밖이라 raw-hex 가드(V1) 사정거리 밖(카드
// cardShadow·searchShadow·fabShadow 선례). searchShadow(radius 8)와 달리 Figma 실측 radius 10.
const softCardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

function SkeletonCard({ index }: { index: number }): ReactElement {
  return (
    <View
      testID={`stay-search-skeleton-${index}`}
      style={softCardShadow}
      className="w-full gap-sm rounded-card border border-hairline bg-canvas p-md"
    >
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
        {[0, 1, 2, 3].map((index) => (
          <SkeletonCard key={index} index={index} />
        ))}
      </View>
    </View>
  );
}
