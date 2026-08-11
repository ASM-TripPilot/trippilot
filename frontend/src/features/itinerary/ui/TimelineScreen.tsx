import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { formatDraftDayHeader } from '../model/draftView';
import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import { timeBandLabel } from '../model/timeBandLabel';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  LockGlyph,
} from './ItineraryGlyphs';

/**
 * h25 완성 일정 시간표 뷰(골격·검증 시각) — Figma `1880:1207`.
 *
 * 이 화면은 완성된 값만 받는다 — 조회도 판정도 하지 않는다. h11 초안과 갈리는 두 규칙이 이
 * 화면의 존재 이유다:
 *  1. 완성이라 `isFixed` 무관하게 **모든 슬롯이 검증 시각을 보인다**(BR-U3-07 · h11 은 고정만).
 *  2. 카드는 **골격만** 그린다 — 서버가 장소명·사진·영업시간·category·거리를 줘도 왼쪽 절반을
 *     그리지 않는다(01b Q2). 넣지 않는 것이라 아예 참조하지 않는다.
 *
 * 자정 넘김은 **문자열로만** 다룬다 — `endsNextDay` 면 `endAt < startAt` 이 정상이라(HC4) Date
 * 파싱·정렬을 하면 시각이 뒤집힌다.
 */

const APPBAR_TITLE = '완성 일정';
const CONFIRM_LABEL = '일정 확정하기';
const SEG_TIMELINE_LABEL = '시간표';
const SEG_MAP_LABEL = '지도';
const FIXED_CHIP = '고정';
const MAP_PLACEHOLDER_NOTE = '지도는 곧 제공돼요';

// 카드 그림자(h11 선례와 동일한 Figma 값). RN 은 box-shadow 가 없어 스타일 프로퍼티로 옮긴다.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 2,
} as const;

export interface ItineraryHeaderData {
  title: string;
  nightsLabel: string;
  totalPlaces: number;
}

export type ViewSegmentValue = 'timeline' | 'map';

export interface TimelineScreenProps {
  header: ItineraryHeaderData;
  days: PlanDayTab[];
  /** 활성 날의 슬롯만 — 페이지가 골라 내린다(키 조회지 판정 아님). */
  slots: ItineraryDaysItemSlotsItem[];
  activeDayIndex: number;
  segment: ViewSegmentValue;
  onSelectDay: (index: number) => void;
  onSegmentChange: (value: ViewSegmentValue) => void;
  onBack: () => void;
}

function SegmentButton({
  value,
  label,
  segment,
  onSegmentChange,
}: {
  value: ViewSegmentValue;
  label: string;
  segment: ViewSegmentValue;
  onSegmentChange: (value: ViewSegmentValue) => void;
}): ReactElement {
  const active = segment === value;
  return (
    <Pressable
      testID={`itinerary-view-segment-${value}`}
      accessibilityRole="button"
      onPress={() => onSegmentChange(value)}
      style={active ? cardShadow : undefined}
      className={`flex-1 items-center justify-center rounded-[8px] py-sm ${
        active ? 'bg-primary' : ''
      }`}
    >
      <Text
        className={`font-noto-bold text-label font-bold ${
          active ? 'text-on-primary' : 'text-muted'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function DayTab({
  tab,
  index,
  selected,
  onSelectDay,
}: {
  tab: PlanDayTab;
  index: number;
  selected: boolean;
  onSelectDay: (index: number) => void;
}): ReactElement {
  return (
    <Pressable
      testID={`itinerary-timeline-day-${tab.dayIndex}`}
      accessibilityRole="button"
      onPress={() => onSelectDay(index)}
      className={`flex-row items-center rounded-pill px-md py-[5px] ${
        selected ? 'bg-primary-pale' : 'border border-hairline-strong'
      }`}
    >
      <Text
        className={`text-label ${
          selected
            ? 'font-noto-bold font-bold text-primary-text'
            : 'font-noto text-body'
        }`}
      >
        {`${tab.dayIndex}일차`}
      </Text>
    </Pressable>
  );
}

/**
 * 카드 한 장 — 골격만. 서버가 준 장소명·사진·영업시간·category·거리·태그는 참조하지 않는다
 * (01b Q2). 완성이라 고정 여부와 무관하게 검증 시각을 그린다(BR-U3-07).
 */
function TimelineSlotCard({
  slot,
  date,
  index,
}: {
  slot: ItineraryDaysItemSlotsItem;
  date: string;
  index: number;
}): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  return (
    <View
      testID={`itinerary-timeline-slot-${slotKey}`}
      style={cardShadow}
      className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas p-md"
    >
      <View className="h-[26px] w-[26px] items-center justify-center rounded-[8px] bg-primary">
        <Text
          testID={`itinerary-timeline-slot-no-${slotKey}`}
          className="font-inter-bold text-label font-bold text-on-primary"
        >
          {String(index + 1)}
        </Text>
      </View>

      <View className="flex-1 items-start gap-xs">
        <View className="flex-row flex-wrap items-center gap-xs">
          <Text
            testID={`itinerary-timeline-slot-time-${slotKey}`}
            className="font-noto text-label text-muted"
          >
            {slot.startAt.slice(0, 5)}
          </Text>
          <Text className="font-noto text-label text-muted">·</Text>
          <Text
            testID={`itinerary-timeline-slot-band-${slotKey}`}
            className="font-noto text-label text-muted"
          >
            {timeBandLabel(slot.startAt)}
          </Text>
          {slot.endsNextDay ? (
            <View
              testID={`itinerary-timeline-slot-endsnext-${slotKey}`}
              className="rounded-pill bg-surface-soft px-sm py-[2px]"
            >
              <Text className="font-noto text-caption text-muted">
                {`익일 ${slot.endAt.slice(0, 5)}`}
              </Text>
            </View>
          ) : null}
        </View>

        {slot.hasViolation ? (
          <View
            testID={`itinerary-edit-violation-${slotKey}`}
            className="flex-row items-center gap-xs rounded-button bg-primary-pale px-sm py-xs"
          >
            <AlertCircleGlyph size={16} tone="primaryText" />
            {slot.violationReason === null ||
            slot.violationReason === undefined ? null : (
              <Text className="font-noto text-caption text-primary-text">
                {slot.violationReason}
              </Text>
            )}
          </View>
        ) : null}
      </View>

      {slot.isFixed ? (
        <View
          testID={`itinerary-timeline-slot-fixed-${slotKey}`}
          className="flex-row items-center gap-xs rounded-pill bg-primary-pale py-xs pl-sm pr-md"
        >
          <LockGlyph />
          <Text className="font-noto-bold text-caption font-bold text-primary-text">
            {FIXED_CHIP}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function TimelineScreen({
  header,
  days,
  slots,
  activeDayIndex,
  segment,
  onSelectDay,
  onSegmentChange,
  onBack,
}: TimelineScreenProps): ReactElement {
  const activeDate = days[activeDayIndex]?.date ?? '';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] bg-canvas pb-sm pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-view-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-section font-bold text-ink">
            {APPBAR_TITLE}
          </Text>
        </View>

        <View
          testID="itinerary-view-header"
          className="gap-xs px-lg pb-md pt-sm"
        >
          <Text className="font-noto-bold text-section font-bold text-ink">
            {`${header.title} · ${header.nightsLabel}`}
          </Text>
          <Text className="font-noto text-label text-muted">
            {`총 ${header.totalPlaces}곳`}
          </Text>
        </View>

        <View className="flex-row gap-[3px] rounded-[8px] bg-hairline p-[3px] mx-lg">
          <SegmentButton
            value="timeline"
            label={SEG_TIMELINE_LABEL}
            segment={segment}
            onSegmentChange={onSegmentChange}
          />
          <SegmentButton
            value="map"
            label={SEG_MAP_LABEL}
            segment={segment}
            onSegmentChange={onSegmentChange}
          />
        </View>

        {days.length === 0 ? null : (
          <View className="flex-row gap-sm px-lg pt-md">
            {days.map((tab, index) => (
              <DayTab
                key={tab.date}
                tab={tab}
                index={index}
                selected={index === activeDayIndex}
                onSelectDay={onSelectDay}
              />
            ))}
          </View>
        )}

        <ScrollView contentContainerClassName="gap-[14px] px-lg pb-lg pt-md">
          {segment === 'timeline' ? (
            <View
              testID="itinerary-view-timeline"
              className="w-full gap-[14px]"
            >
              <View className="w-full flex-row items-center gap-sm">
                <View className="h-[18px] w-[4px] rounded-[2px] bg-primary" />
                <Text className="font-noto text-label text-muted">
                  {formatDraftDayHeader(activeDate)}
                </Text>
                <View className="flex-1" />
                <Text className="font-noto text-label text-muted">
                  {`${slots.length}곳`}
                </Text>
              </View>
              {slots.map((slot, index) => (
                <TimelineSlotCard
                  key={buildSlotKey(activeDate, slot.poiId)}
                  slot={slot}
                  date={activeDate}
                  index={index}
                />
              ))}
            </View>
          ) : null}

          {segment === 'map' ? (
            <View
              testID="itinerary-view-map"
              className="h-[240px] w-full items-center justify-center rounded-card border border-hairline bg-surface-soft"
            >
              <Text className="font-noto text-label text-muted">
                {MAP_PLACEHOLDER_NOTE}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View className="w-full px-lg pb-lg pt-sm">
          <Pressable
            testID="itinerary-view-confirm"
            accessibilityRole="button"
            disabled
            className="h-12 w-full items-center justify-center rounded-button bg-hairline-strong"
          >
            <Text className="font-noto-bold text-[16px] font-bold text-muted-soft">
              {CONFIRM_LABEL}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
