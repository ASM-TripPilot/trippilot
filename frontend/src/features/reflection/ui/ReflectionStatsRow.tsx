import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { ReflectionStats } from '@/shared/api/generated/schemas';

/**
 * TRIP-571 · 통계 3열(방문 · 이동 · 사진). testID `reflection-daily-stats`.
 *
 * 무엇을 보장하나: 근거 수치를 3열 카드로 그린다. 이동 거리는 `distanceDash` 가 true 면 값 대신 "—"
 * (visitCount<2 근사 불가). **소요시간은 없다 — 거리만**(INV-3, `ReflectionStats` 에 duration 필드 부재).
 */

export interface ReflectionStatsRowProps {
  stats: ReflectionStats;
  distanceDash: boolean;
}

function StatCell({
  value,
  label,
}: {
  value: string;
  label: string;
}): ReactElement {
  return (
    <View className="flex-1 items-center gap-[2px]">
      <Text className="font-noto-bold text-[20px] font-bold text-ink">
        {value}
      </Text>
      <Text className="text-label text-muted">{label}</Text>
    </View>
  );
}

export function ReflectionStatsRow({
  stats,
  distanceDash,
}: ReflectionStatsRowProps): ReactElement {
  return (
    <View
      testID="reflection-daily-stats"
      className="w-full flex-row items-center rounded-card border border-hairline bg-canvas px-lg py-[18px]"
    >
      <StatCell value={String(stats.visitCount)} label="방문" />
      <View className="h-[28px] w-px bg-hairline" />
      <StatCell
        value={distanceDash ? '—' : `${stats.distanceKm}km`}
        label="이동"
      />
      <View className="h-[28px] w-px bg-hairline" />
      <StatCell value={String(stats.photoCount)} label="사진" />
    </View>
  );
}
