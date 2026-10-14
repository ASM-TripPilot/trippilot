import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * 온보딩 취향 단계 머리 행 — 진행점 2개 + 「N / 2」 + 「나중에 설정하고 시작」 링크(TRIP-1360, 1/2·2/2 중복 26줄).
 * 점 색은 호출자가 `active` 로 정하고(1/2 = primary + 빈 점, 2/2 = 둘 다 primary) testID 도 호출자가 준다.
 * 스킵 꺾쇠 글리프는 features 소유라 `skipIcon` 슬롯으로 주입한다.
 */
export function PrefStepHeader({
  dots,
  progressLabel,
  skipTestID,
  onSkip,
  skipIcon,
}: {
  dots: { testID: string; active: boolean }[];
  progressLabel: string;
  skipTestID: string;
  onSkip: () => void;
  skipIcon: ReactNode;
}): ReactElement {
  return (
    <View className="flex-row items-center justify-between px-lg pb-sm pt-2xl">
      <View className="flex-row items-center gap-sm">
        <View className="flex-row items-center gap-xs">
          {dots.map((dot) => (
            <View
              key={dot.testID}
              testID={dot.testID}
              className={`h-[6px] w-[6px] rounded-pill ${
                dot.active ? 'bg-primary' : 'bg-hairline'
              }`}
            />
          ))}
        </View>
        <Text className="font-noto text-caption text-muted">
          {progressLabel}
        </Text>
      </View>
      <Pressable
        testID={skipTestID}
        accessibilityRole="button"
        onPress={onSkip}
        className="flex-row items-center gap-[3px]"
      >
        <Text className="font-noto-bold text-body font-bold text-ink underline">
          나중에 설정하고 시작
        </Text>
        {skipIcon}
      </Pressable>
    </View>
  );
}
