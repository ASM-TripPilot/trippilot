import type { ReactElement, ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';
import { BottomTabBar, type ShellTabKey } from '@/shared/ui/BottomTabBar';

import type { ActualRouteView } from '../model/actualDistance';
import type { LivePlanToggle, LiveSegment } from '../model/liveViewStore';
import { buildMapPeek } from '../model/mapPeek';
import { resolveNextDest, type NavDest } from '../model/nextNav';
import type { ProjectedSlot, SlotState } from '../model/slotProgress';
import {
  RailActiveGlyph,
  RailDoneGlyph,
  RailUpcomingGlyph,
  ShieldGlyph,
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
  /** "다음 장소 길찾기" — page 가 openNextNav(딥링크 폴백 사다리)로 배선. active 다음 첫 upcoming 을 넘긴다. */
  onPressNextNav?: (dest: NavDest) => void;
  /** active 카드 [방문 완료] — page 가 도출한 visitCheckId 로 완료 낙관을 미리 바인딩해 넘긴다(AC-3). */
  onPressComplete?: () => void;
  /** upcoming 카드 수동 [도착] — page 가 poiId 로 arrive({source:MANUAL})를 배선(AC-4). */
  onManualArrive?: (poiId: string) => void;
  /**
   * TRIP-561 · 상단 상주 트리거 칩(i08) — 발화 중이면 page 가 조립해 내린다. 헤더 아래·타임라인
   * 위에 렌더(있을 때만). additive optional(기본 undefined) — 프로즌 S1~S8 무회귀(`peek` 선례).
   */
  triggerChip?: ReactNode;
  /**
   * TRIP-561 · 슬롯별 변수감지 배너(i01) — 슬롯마다 slotKey 로 호출해 매칭이면 배너 노드, 아니면
   * null 을 돌려준다(칩=상시·배너=slotKey 매칭 구분). additive optional(`renderSlotPanel` 선례).
   */
  renderSlotBanner?: (slotKey: string) => ReactNode;
  /**
   * TRIP-562 · 감시 목록(i09) 진입 FAB(하단 우측 탭바 위) — page 가 `router.push` 로 배선한다.
   * additive optional(기본 undefined) — 프로즌 S1~S8 무회귀. FAB 는 항상 렌더(상시 진입점), press 가
   * `onPressWatchlist?.()`(미제공이면 무해 no-op). execution→planb 직접 import 없이 콜백 prop 하나로만.
   */
  onPressWatchlist?: () => void;
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
  onPressNextNav,
  onPressComplete,
  onManualArrive,
  triggerChip,
  renderSlotBanner,
  onPressWatchlist,
}: LiveItineraryScreenProps): ReactElement {
  const activeDate = days[activeDayIndex]?.date ?? '';
  // 진행 중 슬롯 다음 첫 upcoming(좌표 유한)을 다음 예정지로 도출 — active 카드에만 주입한다.
  const nextDest = resolveNextDest(slots);

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

      {triggerChip}

      {segment === 'map' ? (
        <LiveMapScreen
          slots={slots.map((projected) => projected.slot)}
          toggle={toggle}
          onToggle={onToggle}
          actualRoute={actualRoute}
          // peek 은 진행 상태가 필요해 raw slots 로는 못 만든다 — ProjectedSlot[] 을 가진 여기서
          // 도출해 내린다(★1, page 로 안 올리는 이유는 03B). "전체 일정 >" 은 일정 세그먼트 전환.
          peek={buildMapPeek(slots)}
          onPressFullItinerary={() => onSelectSegment('itinerary')}
        />
      ) : (
        <ScrollView contentContainerClassName="gap-md px-lg pb-[112px] pt-xs">
          {slots.map((projected) => (
            <View key={projected.slot.poiId} className="flex-row gap-md">
              <View className="w-[58px] flex-row gap-[4px]">
                <Text className="w-[32px] pt-[6px] text-right font-noto-medium text-caption text-body">
                  {projected.slot.startAt.slice(0, 5)}
                </Text>
                <View className="w-[22px] items-center">
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
                  nextDest={projected.state === 'active' ? nextDest : undefined}
                  onPressNextNav={
                    projected.state === 'active' && nextDest
                      ? () => onPressNextNav?.(nextDest)
                      : undefined
                  }
                  onPressComplete={
                    projected.state === 'active' ? onPressComplete : undefined
                  }
                  onPressManualArrive={
                    projected.state === 'upcoming'
                      ? () => onManualArrive?.(projected.slot.poiId)
                      : undefined
                  }
                />
                {renderSlotBanner?.(`${activeDate}#${projected.slot.poiId}`)}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* 감시 목록(i09) 진입 FAB — 지도 세그먼트의 형제 노드(KakaoMapView 오버레이 터치 흡수 회피,
          repo-traps). 탭바 밴드(84px) 위(bottom>84)에 앉힌다. 항상 렌더, press→콜백. */}
      <Pressable
        testID="execution-live-watchlist-fab"
        accessibilityRole="button"
        onPress={() => onPressWatchlist?.()}
        className="absolute bottom-[100px] right-lg h-[56px] w-[56px] items-center justify-center rounded-pill bg-primary shadow-lg"
      >
        <ShieldGlyph size={24} />
      </Pressable>

      <BottomTabBar activeKey="itinerary" onPressTab={onPressTab} />
    </SafeAreaView>
  );
}
