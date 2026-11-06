import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CARD_SHADOW } from '@/features/settings';

/**
 * TRIP-1790 · l03 「지금까지」 통계 카드(Figma E9 5237:4052) — props 만 받는 순수 카드. 조회·판정은 `MyPage` 몫.
 *
 * 세 칸(여행·도시·방문) 값은 한 Text 다(`12+` — `+` 를 쪼개면 완전 일치 단언이 깨진다). 모름(loading·failed)은 `–`,
 * 0 은 숫자 0(INV-4). 거리·시간 칸은 두지 않는다(INV-3). 「다시 시도」는 `onRetry` 가 있는 failed 에만 — 누를 곳 없는 버튼 금지.
 * 칸 모양은 `ProfileCard.StatCell` 과 같다(칸 사이 한 변 선은 border 가 아니라 막대 View — repo-traps 「테두리」).
 */

export type StatsVM =
  | {
      kind: 'ready';
      trips: number;
      cities: number;
      visits: number;
      truncated: boolean;
    }
  | { kind: 'loading' }
  | { kind: 'failed'; retrying: boolean };

function Cell({
  cell,
  label,
  value,
}: {
  cell: 'trips' | 'cities' | 'visits';
  label: string;
  value: string | null;
}): ReactElement {
  return (
    <View testID={`my-stats-${cell}`} className="flex-1 items-center gap-xs">
      <Text
        testID={`my-stats-${cell}-value`}
        className={`font-inter-bold text-[20px] font-bold ${value === null ? 'text-muted-soft' : 'text-ink'}`}
      >
        {value ?? '–'}
      </Text>
      <Text className="font-noto text-caption text-muted">{label}</Text>
    </View>
  );
}

export function StatsCard({
  stats,
  onRetry,
}: {
  stats: StatsVM;
  onRetry?: () => void;
}): ReactElement {
  const ready = stats.kind === 'ready' ? stats : null;
  const show = (n: number | undefined): string | null =>
    n === undefined ? null : `${n}${ready?.truncated ? '+' : ''}`;
  const retrying = stats.kind === 'failed' && stats.retrying;

  return (
    <View
      testID="my-stats-card"
      style={CARD_SHADOW}
      className="w-full gap-[14px] rounded-[12px] border border-hairline bg-canvas p-lg"
    >
      <View className="flex-row items-center justify-between">
        <View className="shrink gap-[2px]">
          <Text className="font-noto-bold text-[16px] font-bold text-ink">
            지금까지
          </Text>
          <Text className="font-noto text-caption text-muted">
            종료한 여행만 센다
          </Text>
        </View>
        {stats.kind === 'failed' && onRetry ? (
          <Pressable
            testID="my-stats-retry"
            accessibilityRole="button"
            disabled={retrying}
            accessibilityState={{ disabled: retrying }}
            onPress={onRetry}
            hitSlop={10}
          >
            <Text
              className={`font-noto text-label ${retrying ? 'text-muted-soft' : 'text-primary'}`}
            >
              다시 시도
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View className="h-px bg-hairline" />

      <View className="flex-row items-center">
        <Cell cell="trips" label="여행" value={show(ready?.trips)} />
        <View className="h-[30px] w-px bg-hairline" />
        <Cell cell="cities" label="도시" value={show(ready?.cities)} />
        <View className="h-[30px] w-px bg-hairline" />
        <Cell cell="visits" label="방문" value={show(ready?.visits)} />
      </View>
    </View>
  );
}
