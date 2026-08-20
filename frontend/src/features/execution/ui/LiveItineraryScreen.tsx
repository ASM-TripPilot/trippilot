import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';
import { BottomTabBar, type ShellTabKey } from '@/shared/ui/BottomTabBar';

import type { ActualRouteView } from '../model/actualDistance';
import type { LivePlanToggle, LiveSegment } from '../model/liveViewStore';
import type { ProjectedSlot, SlotState } from '../model/slotProgress';
import {
  RailActiveGlyph,
  RailDoneGlyph,
  RailUpcomingGlyph,
} from './ExecutionGlyphs';
import { LiveMapScreen } from './LiveMapScreen';
import { LiveSlotCard } from './LiveSlotCard';

/**
 * TRIP-395 · LiveItineraryScreen(i01) — 여행 중 일정. 헤더(제목·부제·일자칩·세그먼트) +
 * 좌측 레일 타임라인 + 하단 복제 탭바(유일한 탈출구, 뒤로가기 버튼 없음).
 *
 * 규율:
 *  - 일차 순번("N일차")과 헤더 제목의 순번은 `activeDayIndex + 1`(index 산술 — 시각 가드 무관).
 *    부제(날짜 문자열)는 page/shared 가 포맷해 prop 으로 내린다 — execution 안에서 날짜를
 *    포맷하면 시각-무추정 구조가드(liveTimeStructure)에 걸린다.
 *  - 레일 시각은 서버 `startAt` 을 `slice` 로 자를 뿐(재추정 없음).
 */

const SEGMENTS: { key: LiveSegment; label: string }[] = [
  { key: 'itinerary', label: '일정' },
  { key: 'map', label: '지도' },
];

function RailDot({ state }: { state: SlotState }): ReactElement {
  if (state === 'done') return <RailDoneGlyph size={20} />;
  if (state === 'active') return <RailActiveGlyph size={20} />;
  return <RailUpcomingGlyph size={16} />;
}

export interface LiveItineraryScreenProps {
  days: ItineraryDaysItem[];
  /** 오늘(또는 사용자가 고른 날)의 인덱스. */
  activeDayIndex: number;
  /** 활성 날의 사영된 슬롯 — 페이지가 slotProgress 로 만들어 내린다. */
  slots: ProjectedSlot[];
  segment: LiveSegment;
  onSelectDay: (index: number) => void;
  onSelectSegment: (segment: LiveSegment) => void;
  /** 지도 세그먼트의 계획｜실제 토글 + 실제 경로 판정(위치 동의 게이트). */
  toggle: LivePlanToggle;
  onToggle: (toggle: LivePlanToggle) => void;
  actualRoute: ActualRouteView;
  /** 헤더 제목의 trip.title 부분(page 가 trip 조회로 주입). */
  tripTitle: string;
  /** 헤더 부제 — page/shared 가 조립한 완성 문자열("M월 D일 요일 · 오늘 일정"). */
  subtitle: string;
  /** 하단 복제 탭바 콜백 — page 가 router.replace 로 배선. */
  onPressTab: (key: ShellTabKey) => void;
}

export function LiveItineraryScreen({
  days,
  activeDayIndex,
  slots,
  segment,
  onSelectDay,
  onSelectSegment,
  toggle,
  onToggle,
  actualRoute,
  tripTitle,
  subtitle,
  onPressTab,
}: LiveItineraryScreenProps): ReactElement {
  const activeDate = days[activeDayIndex]?.date ?? '';

  return (
    <SafeAreaView
      testID="execution-live-screen"
      edges={['top']}
      style={{ flex: 1 }}
      className="bg-canvas-alt"
    >
      <View className="gap-md px-lg pb-sm pt-md">
        <View className="gap-[4px]">
          <Text
            testID="execution-live-header-title"
            className="font-noto-bold text-[24px] font-bold leading-[30px] text-ink"
          >
            {`${tripTitle} · ${activeDayIndex + 1}일차`}
          </Text>
          <Text
            testID="execution-live-header-subtitle"
            className="font-noto text-[16px] text-muted"
          >
            {subtitle}
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="grow-0"
          contentContainerClassName="gap-sm"
        >
          {days.map((_day, index) => {
            const selected = index === activeDayIndex;
            return (
              <Pressable
                key={index}
                testID={`execution-live-daychip-${index}`}
                onPress={() => onSelectDay(index)}
                className={`rounded-pill border px-md py-[4px] ${
                  selected ? 'border-primary' : 'border-hairline-strong'
                }`}
              >
                <Text
                  className={`font-noto-medium text-label ${
                    selected ? 'text-primary' : 'text-muted'
                  }`}
                >
                  {`${index + 1}일차`}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View className="flex-row gap-[4px] rounded-button bg-surface-soft p-[4px]">
          {SEGMENTS.map(({ key, label }) => {
            const selected = key === segment;
            return (
              <Pressable
                key={key}
                testID={`execution-live-segment-${key}`}
                onPress={() => onSelectSegment(key)}
                className={`flex-1 items-center rounded-button py-sm ${
                  selected ? 'bg-primary' : ''
                }`}
              >
                <Text
                  className={`font-noto-medium text-label ${
                    selected ? 'text-on-primary' : 'text-muted'
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {segment === 'map' ? (
        <LiveMapScreen
          slots={slots.map((projected) => projected.slot)}
          toggle={toggle}
          onToggle={onToggle}
          actualRoute={actualRoute}
        />
      ) : (
        <ScrollView contentContainerClassName="gap-md px-lg pb-[112px] pt-xs">
          {slots.map((projected) => (
            <View key={projected.slot.poiId} className="flex-row">
              <View className="w-[52px] flex-row">
                <Text className="w-[36px] pt-[6px] text-right font-noto-medium text-caption text-body">
                  {projected.slot.startAt.slice(0, 5)}
                </Text>
                <View className="w-[16px] items-center">
                  <View className="absolute bottom-0 top-0 w-[2px] bg-hairline-strong" />
                  <View className="mt-[4px] rounded-full bg-canvas-alt p-[1px]">
                    <RailDot state={projected.state} />
                  </View>
                </View>
              </View>
              <View className="flex-1">
                <LiveSlotCard
                  slot={projected.slot}
                  date={activeDate}
                  state={projected.state}
                />
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <BottomTabBar activeKey="itinerary" onPressTab={onPressTab} />
    </SafeAreaView>
  );
}
