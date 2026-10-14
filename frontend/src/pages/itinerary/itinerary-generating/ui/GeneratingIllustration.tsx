import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';

import { startUnlessReduceMotion } from '@/shared/lib/reduceMotion';

/**
 * h07 생성 중 일러스트 "빈 일정 카드 섞기"(TRIP-1384 · Figma `4889:3061`). 장식이라 글자·숫자·시간이 없고
 * 접근성 트리에서 숨긴다(INV-1/2/3). 진행률·단계 완료를 말하지 않는다 — "섞이는 중"만 보인다(INV-4).
 *
 * 맨 위 카드(primary 강조·-2° 기울기)와 맨 아래 카드가 자리를 바꿨다 돌아오고 가운데 카드는 제자리다
 * (3.6초 루프: 대기 0.3 → 교환 1.2 → 대기 0.6 → 복귀 1.2 → 대기 0.3). RN `Animated`(네이티브 드라이버)
 * 라 자체 타이머가 없다. 동작 줄이기면 시작하지 않아 Figma 정지 컷(원래 자리)에 선다.
 * 박자·휨 폭은 Figma 모션 정의가 없어 발명값(6-b 육안 조정).
 */

const CARD_HEIGHT = 56;
const CARD_GAP = 12;
/** 맨 위 ↔ 맨 아래 카드가 오가는 거리(두 칸). */
const SWAP_DISTANCE = (CARD_HEIGHT + CARD_GAP) * 2;
/** 교환 중 가운데 카드를 비켜 가는 옆 휨. */
const BOW = 10;
const STACK_HEIGHT = CARD_HEIGHT * 3 + CARD_GAP * 2;
/** 세로 점선 커넥터 — 3px 점 + 3px 간격. */
const CONNECTOR_DOTS = Math.floor(STACK_HEIGHT / 6);

function PlaceholderCard({
  testID,
  highlighted = false,
}: {
  testID: string;
  highlighted?: boolean;
}): ReactElement {
  return (
    <View
      testID={testID}
      className={`h-[56px] w-full flex-row items-center gap-md rounded-[12px] border bg-canvas px-lg ${
        highlighted ? 'border-primary' : 'border-hairline'
      }`}
    >
      <View
        className={`h-[10px] w-[10px] rounded-pill ${
          highlighted ? 'bg-primary' : 'bg-hairline-strong'
        }`}
      />
      <View className="flex-1 gap-sm">
        <View className="h-[8px] w-[60%] rounded-pill bg-surface-strong" />
        <View className="h-[8px] w-[36%] rounded-pill bg-surface-strong" />
      </View>
    </View>
  );
}

export function GeneratingIllustration(): ReactElement {
  const swap = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const move = (toValue: number) =>
      Animated.timing(swap, {
        toValue,
        duration: 1200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      });
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(300),
        move(1),
        Animated.delay(600),
        move(0),
        Animated.delay(300),
      ])
    );
    return startUnlessReduceMotion(loop, () => swap.setValue(0));
  }, [swap]);

  const topY = swap.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SWAP_DISTANCE],
  });
  const bottomY = swap.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -SWAP_DISTANCE],
  });
  const topX = swap.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, -BOW, 0],
  });
  const bottomX = swap.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, BOW, 0],
  });

  return (
    <View
      testID="itinerary-generating-illustration"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: STACK_HEIGHT }}
      className="w-full max-w-[342px] self-center"
    >
      {/* 세로 점선 커넥터(결정 (a) 유지) — 카드 뒤에 깔려 카드 사이 틈에서만 보인다. */}
      <View className="absolute bottom-0 left-[28px] top-0 items-center justify-between">
        {Array.from({ length: CONNECTOR_DOTS }, (_, i) => (
          <View
            key={i}
            className="h-[3px] w-[3px] rounded-pill bg-hairline-strong"
          />
        ))}
      </View>

      <View style={{ gap: CARD_GAP }}>
        <Animated.View
          style={{
            zIndex: 2,
            transform: [
              { translateX: topX },
              { translateY: topY },
              { rotate: '-2deg' },
            ],
          }}
        >
          <PlaceholderCard
            testID="itinerary-generating-illustration-card-top"
            highlighted
          />
        </Animated.View>
        <View style={{ marginLeft: 8, marginRight: -8 }}>
          <PlaceholderCard testID="itinerary-generating-illustration-card-middle" />
        </View>
        <Animated.View
          style={{
            transform: [{ translateX: bottomX }, { translateY: bottomY }],
          }}
        >
          <PlaceholderCard testID="itinerary-generating-illustration-card-bottom" />
        </Animated.View>
      </View>
    </View>
  );
}
