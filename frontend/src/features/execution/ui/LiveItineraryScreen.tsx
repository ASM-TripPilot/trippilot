import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

import type { LiveSegment } from '../model/liveViewStore';
import type { ProjectedSlot } from '../model/slotProgress';
import { LiveSlotCard } from './LiveSlotCard';

/**
 * TRIP-395 · LiveItineraryScreen(i01) — 여행 중 일정의 default 렌더 = "기록 없음" 변형.
 * 일자 칩 · 세그먼트(일정｜지도) · 타임라인. 기록이 아직 없으면 전 슬롯이 예정으로 그려진다.
 *
 * 규율:
 *  - 일자 칩은 **"N일차"**(순번)로 라벨한다 — `new Date(day.date)` 로 요일·월일을 뽑지 않는다.
 *    여기서 Date 산술을 쓰면 시각-무추정 구조가드(liveTimeStructure)에 걸린다. 순번은 안전하다.
 *  - 지도 세그먼트(i02·i03)는 TRIP-397 소관 — 이 칸에서는 "준비 중" 자리만 둔다(빈 화면 대신).
 */

const SEGMENTS: { key: LiveSegment; label: string }[] = [
  { key: 'itinerary', label: '일정' },
  { key: 'map', label: '지도' },
];

const MAP_PLACEHOLDER = '지도는 곧 제공돼요';

export interface LiveItineraryScreenProps {
  days: ItineraryDaysItem[];
  /** 오늘(또는 사용자가 고른 날)의 인덱스. */
  activeDayIndex: number;
  /** 활성 날의 사영된 슬롯 — 페이지가 slotProgress 로 만들어 내린다. */
  slots: ProjectedSlot[];
  segment: LiveSegment;
  onSelectDay: (index: number) => void;
  onSelectSegment: (segment: LiveSegment) => void;
}

export function LiveItineraryScreen({
  days,
  activeDayIndex,
  slots,
  segment,
  onSelectDay,
  onSelectSegment,
}: LiveItineraryScreenProps): ReactElement {
  const activeDate = days[activeDayIndex]?.date ?? '';

  return (
    <SafeAreaView
      testID="execution-live-screen"
      edges={['top']}
      style={{ flex: 1 }}
      className="bg-canvas-alt"
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-sm px-lg py-md"
      >
        {days.map((_day, index) => {
          const selected = index === activeDayIndex;
          return (
            <Pressable
              key={index}
              testID={`execution-live-daychip-${index}`}
              onPress={() => onSelectDay(index)}
              className={`rounded-pill px-md py-sm ${
                selected ? 'bg-primary' : 'bg-surface-soft'
              }`}
            >
              <Text
                className={`font-noto-medium text-label ${
                  selected ? 'text-on-primary' : 'text-body'
                }`}
              >
                {`${index + 1}일차`}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View className="flex-row gap-xs px-lg pb-sm">
        {SEGMENTS.map(({ key, label }) => {
          const selected = key === segment;
          return (
            <Pressable
              key={key}
              testID={`execution-live-segment-${key}`}
              onPress={() => onSelectSegment(key)}
              className={`rounded-button px-lg py-sm ${
                selected ? 'bg-ink' : 'bg-surface-soft'
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

      {segment === 'map' ? (
        <View
          testID="execution-live-map-placeholder"
          className="flex-1 items-center justify-center px-lg"
        >
          <Text className="font-noto text-body text-muted">
            {MAP_PLACEHOLDER}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerClassName="gap-md px-lg pb-2xl">
          {slots.map((projected) => (
            <LiveSlotCard
              key={projected.slot.poiId}
              slot={projected.slot}
              date={activeDate}
              state={projected.state}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
