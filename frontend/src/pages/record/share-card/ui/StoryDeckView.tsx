import { useEffect, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CATEGORY_PALETTES } from '@/features/reflection/index.view';

import type { StorySlide } from '../model/shareStory';
import { HOLD_DELAY_MS } from '../model/storyDeck';
import { StorySlideView, slidePalette } from './StorySlides';

/**
 * TRIP-1667 · j06 스토리 덱의 순수 뷰 — 지금 장 하나 + 진행 바 + 좌/우 탭 영역 + × + (마지막 장에만) [공유 카드 만들기].
 * 시간·장 번호는 모른다(`useStoryDeck` 가 정해서 내려 준다). 지금 장만 `key={slide.key}` 로 마운트해 장이 나올 때 연출이 처음부터 재생된다.
 * `@/shared/api` 값 import 0 — 개발 프리뷰가 이 파일을 문다.
 *
 * 탭 영역은 `onPress` 로 탭을 받는다(화면 낭독기의 클릭은 onPress 만 온다). `onLongPress` 는 하는 일 없이 달아 둔다 — Pressable 은
 * `onLongPress` 가 있을 때만 긴 누름 뒤의 `onPress` 를 막는다. 멈춤은 `onPressIn`/`onPressOut`. 연타 가드(`guardPress`)는 걸지 않는다.
 * 레이아웃·진행 바 색·버튼 위치는 HTML 시안 기준 가정(Figma 확인 전).
 */

const ID = 'reflection-share-deck';
const SEGMENT_TEXT = {
  done: '지남',
  current: '지금',
  upcoming: '남음',
} as const;

export interface StoryDeckViewProps {
  slides: StorySlide[];
  index: number;
  segments: ('done' | 'current' | 'upcoming')[];
  /** 지금 칸이 어디서(0~1)부터 몇 ms 동안 차오르는가 — 길이 null 이면 멈춤. */
  fill: { from: number; durationMs: number | null };
  caption: string;
  hashtagText: string;
  onPressIn: () => void;
  onPressOut: () => void;
  onLongPress: () => void;
  onTap: (side: 'left' | 'right') => void;
  onClose: () => void;
  onMake: () => void;
}

/**
 * 진행 바 한 칸. 색칠(너비)만 reanimated 가 움직이고 "지금 몇 번째 장인가"는 정하지 않는다.
 * 지난 칸은 가득, 남은 칸은 비고, 지금 칸은 `from` 에서 `durationMs` 동안 차오른다(길이 null 이면 그 자리에 멈춤).
 */
function Segment({
  state,
  fill,
  color,
  testID,
}: {
  state: 'done' | 'current' | 'upcoming';
  fill: StoryDeckViewProps['fill'];
  color: string;
  testID: string;
}): ReactElement {
  const progress = useSharedValue(state === 'done' ? 1 : 0);
  const { from, durationMs } = fill;

  useEffect(() => {
    cancelAnimation(progress);
    if (state !== 'current') {
      progress.value = state === 'done' ? 1 : 0;
      return;
    }
    progress.value = from;
    if (durationMs !== null) {
      progress.value = withTiming(1, {
        duration: durationMs,
        easing: Easing.linear,
      });
    }
    return () => cancelAnimation(progress);
  }, [state, from, durationMs, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <View
      testID={testID}
      accessibilityValue={{ text: SEGMENT_TEXT[state] }}
      className="h-[3px] flex-1 overflow-hidden rounded-[2px]"
    >
      <View
        className="absolute inset-0"
        style={{ backgroundColor: color, opacity: 0.3 }}
      />
      <Animated.View
        className="h-full"
        style={[{ backgroundColor: color }, fillStyle]}
      />
    </View>
  );
}

export function StoryDeckView({
  slides,
  index,
  segments,
  fill,
  caption,
  hashtagText,
  onPressIn,
  onPressOut,
  onLongPress,
  onTap,
  onClose,
  onMake,
}: StoryDeckViewProps): ReactElement {
  const slide = slides[Math.min(index, slides.length - 1)];
  const palette = CATEGORY_PALETTES[slidePalette(slide)];
  const isLast = index === slides.length - 1;
  const zoneProps = { onPressIn, onPressOut, onLongPress };

  return (
    <View
      testID={ID}
      className="flex-1"
      style={{ backgroundColor: palette.bg }}
    >
      <StorySlideView
        key={slide.key}
        slide={slide}
        caption={caption}
        hashtagText={hashtagText}
      />

      {/* 탭 영역 — 장 위 전면, 컨트롤(아래 오버레이)보다 아래. 왼쪽 35% 이전 · 나머지 다음. */}
      <Pressable
        testID={`${ID}-prev`}
        accessibilityRole="button"
        accessibilityLabel="이전 장"
        delayLongPress={HOLD_DELAY_MS}
        onPress={() => onTap('left')}
        className="absolute inset-y-0 left-0 w-[35%]"
        {...zoneProps}
      />
      <Pressable
        testID={`${ID}-next`}
        accessibilityRole="button"
        accessibilityLabel="다음 장"
        delayLongPress={HOLD_DELAY_MS}
        onPress={() => onTap('right')}
        className="absolute inset-y-0 right-0 w-[65%]"
        {...zoneProps}
      />

      {/* 컨트롤 — 빈 곳은 아래 탭 영역으로 터치를 넘긴다(box-none). */}
      <SafeAreaView
        edges={['top', 'bottom']}
        pointerEvents="box-none"
        className="absolute inset-0 justify-between"
      >
        <View pointerEvents="box-none" className="gap-md px-lg pt-md">
          <View
            testID={`${ID}-progress`}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 1, max: slides.length, now: index + 1 }}
            className="flex-row gap-[4px]"
          >
            {segments.map((state, i) => (
              <Segment
                // 장 수는 고정 길이 목록이라 순번이 곧 신원이다.
                key={i}
                testID={`${ID}-seg-${i}`}
                state={state}
                fill={fill}
                color={palette.fg}
              />
            ))}
          </View>
          <View className="flex-row justify-end">
            <Pressable
              testID={`${ID}-close`}
              accessibilityRole="button"
              accessibilityLabel="닫기"
              hitSlop={12}
              onPress={onClose}
              className="h-[32px] w-[32px] items-center justify-center"
            >
              <View
                className="absolute h-[2px] w-[18px] rotate-45 rounded-[1px]"
                style={{ backgroundColor: palette.fg }}
              />
              <View
                className="absolute h-[2px] w-[18px] -rotate-45 rounded-[1px]"
                style={{ backgroundColor: palette.fg }}
              />
            </Pressable>
          </View>
        </View>

        <View pointerEvents="box-none" className="px-lg pb-lg">
          {isLast ? (
            <Pressable
              testID={`${ID}-make`}
              accessibilityRole="button"
              onPress={onMake}
              className="h-[56px] items-center justify-center rounded-button"
              style={{ backgroundColor: palette.accent }}
            >
              <Text
                className="font-noto-bold text-card-title"
                style={{ color: palette.bg }}
              >
                공유 카드 만들기
              </Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}
