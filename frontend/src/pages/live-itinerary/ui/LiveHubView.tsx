import { useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View, type ImageSourcePropType } from 'react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import type { MapCenter } from '@/shared/map';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';
import { BackChevronGlyph } from '@/widgets/map-sheet-shell/ui/MapSheetGlyphs';
import { formatCoPickDayHeader } from '@/features/itinerary/model/draftView';
import { PencilGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';
import {
  RailActiveGlyph,
  RailDoneGlyph,
  RailUpcomingGlyph,
} from '@/features/execution/ui/ExecutionGlyphs';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import {
  buildStatePins,
  type SlotProgressState,
} from '@/entities/itinerary-slot/lib/slotMapPin';
import { SlotProgressCard } from '@/entities/itinerary-slot/ui/SlotProgressCard';

/**
 * TRIP-746 · i01 여행중 허브 **순수 뷰**(pages · api import 0 — preview 가 직접 import, TRIP-610).
 * 전면 지도(셸, 조작 가능) 위 좌상단 뒤로가기 + 일자 칩, 3스냅 시트(헤더 한 줄 + 레일 타임라인 +
 * 카드 3상태), 우하단 "일정 수정" 연필 FAB. 조회·판정·라우팅은 페이지(LiveItineraryPage) 몫이고,
 * 이 뷰가 가진 상태는 "준비 중" 힌트 열림 하나뿐이다(카드가 entities 라 상태를 못 가진다).
 *
 * ⚠️ 원리적 사각(6-b): 3스냅 실전환·스냅별 보임·FAB 가림·지도 제스처 실해제는 jest 가 못 본다.
 */

// 닫힘(핸들만 28px) · 중간 55% · 펼침 86%(Figma 4251:2448 · 4251:2640 · 4125:3957).
const SNAP_POINTS: (string | number)[] = [28, '55%', '86%'];
// 좌표 있는 슬롯이 하나도 없을 때의 결정론적 지도 중심(서울 시청, 옛 LiveMapScreen 값 계승).
const FALLBACK_CENTER: MapCenter = { lat: 37.5665, lng: 126.978 };

// 그림자 색은 토큰이 없다 — DayChipOverlay `#000000` 스타일 객체 관례.
const BACK_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 3,
} as const;
const FAB_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 4,
} as const;

export interface LiveHubSlot {
  slot: ItineraryDaysItemSlotsItem;
  state: SlotProgressState;
  photos?: ImageSourcePropType[];
  memo?: string | null;
}

export interface LiveHubViewProps {
  tripTitle: string;
  /** 칩 개수 + 헤더 날짜 출처. */
  days: { date: string }[];
  activeDayIndex: number;
  slots: LiveHubSlot[];
  /** 0 닫힘 / 1 중간 / 2 펼침. 미전달이면 중간. */
  initialSnapIndex?: number;
  currentLocation?: MapCenter;
  onBack: () => void;
  onSelectDay: (index: number) => void;
  /** 연필 FAB — 수동 재계획 진입(BR-U4-10). */
  onPressReplan: () => void;
  /** active 카드 [방문 완료]. */
  onPressComplete?: () => void;
  /** TRIP-561 트리거 칩 — 748 재배치 전까지 시트 헤더 아래에 유지. */
  triggerChip?: ReactNode;
  /** TRIP-561 슬롯 배너 — slotKey 매칭이면 노드, 아니면 null. */
  renderSlotBanner?: (slotKey: string) => ReactNode;
}

// 레일 점의 행 상단 여백 — 점 크기(18·16·12)가 달라 Figma 에서 상태마다 다르다(rail 인스턴스 y 실측).
const RAIL_TOP: Record<SlotProgressState, string> = {
  done: 'pt-[11px]',
  active: 'pt-[6px]',
  upcoming: 'pt-[8px]',
};

function RailDot({ state }: { state: SlotProgressState }): ReactElement {
  if (state === 'done') return <RailDoneGlyph />;
  if (state === 'active') return <RailActiveGlyph />;
  return <RailUpcomingGlyph />;
}

export function LiveHubView({
  tripTitle,
  days,
  activeDayIndex,
  slots,
  initialSnapIndex = 1,
  currentLocation,
  onBack,
  onSelectDay,
  onPressReplan,
  onPressComplete,
  triggerChip,
  renderSlotBanner,
}: LiveHubViewProps): ReactElement {
  const [soonHintVisible, setSoonHintVisible] = useState(false);
  const activeDate = days[activeDayIndex]?.date ?? '';

  const header = [
    tripTitle,
    `${activeDayIndex + 1}일차`,
    formatCoPickDayHeader(activeDate),
    `${slots.length}곳`,
  ]
    .filter((piece) => piece !== '')
    .join(' · ');

  const pins = buildStatePins(
    slots.map(({ slot, state }) => ({
      lat: slot.lat,
      lng: slot.lng,
      progress: state,
    }))
  );
  const center = pins[0]
    ? { lat: pins[0].lat, lng: pins[0].lng }
    : FALLBACK_CENTER;

  const overlay = (
    <View className="flex-row items-center gap-sm">
      <Pressable
        testID="execution-live-back"
        accessibilityRole="button"
        onPress={onBack}
        style={BACK_SHADOW}
        className="h-[40px] w-[40px] items-center justify-center rounded-pill bg-canvas"
      >
        <BackChevronGlyph size={20} />
      </Pressable>
      {days.map((_day, index) => {
        const selected = index === activeDayIndex;
        return (
          <Pressable
            key={index}
            testID={`execution-live-daychip-${index}`}
            onPress={() => onSelectDay(index)}
            accessibilityState={{ selected }}
            className={`rounded-pill px-[14px] py-sm ${
              selected
                ? 'bg-primary'
                : 'border border-hairline-strong bg-canvas'
            }`}
          >
            <Text
              className={
                selected
                  ? 'font-noto-bold text-body font-bold text-on-primary'
                  : 'font-noto text-body text-body'
              }
            >
              {`${index + 1}일차`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View testID="execution-live-screen" className="flex-1">
      <MapSheetShell
        center={center}
        pins={pins}
        mapViewOnly={false}
        currentLocation={currentLocation}
        overlay={overlay}
        snapPoints={SNAP_POINTS}
        initialIndex={initialSnapIndex}
        header={
          <View className="gap-[10px] px-lg">
            <Text
              testID="execution-live-sheet-header"
              className="font-noto-bold text-card-title font-bold text-ink"
            >
              {header}
            </Text>
            {triggerChip}
          </View>
        }
      >
        {/* 타임라인 — 레일 칸 28 + 카드. 세로선(2px)은 레일 칸 가운데, 첫 행 윗변 20px 아래부터 끝까지. */}
        <View className="gap-[22px] px-[20px] pb-[76px] pt-xl">
          <View className="absolute bottom-0 left-[33px] top-[40px] w-[2px] bg-hairline-strong" />
          {slots.map(({ slot, state, photos, memo }) => {
            const slotKey = buildSlotKey(activeDate, slot.poiId);
            return (
              <View key={slotKey} className="flex-row">
                <View className={`w-[28px] items-center ${RAIL_TOP[state]}`}>
                  <RailDot state={state} />
                </View>
                <View className="flex-1 gap-sm">
                  <SlotProgressCard
                    slot={slot}
                    date={activeDate}
                    state={state}
                    photos={photos}
                    memo={memo}
                    onPressComplete={
                      state === 'active' ? onPressComplete : undefined
                    }
                    onPressSoon={() => setSoonHintVisible(true)}
                    soonHintVisible={soonHintVisible}
                  />
                  {renderSlotBanner?.(slotKey)}
                </View>
              </View>
            );
          })}
        </View>
      </MapSheetShell>

      {/* 일정 수정 FAB — 시트와 무관하게 우하단 고정(시트 위에 뜬다). */}
      <Pressable
        testID="execution-live-replan-fab"
        accessibilityRole="button"
        accessibilityLabel="일정 수정"
        onPress={onPressReplan}
        style={FAB_SHADOW}
        className="absolute bottom-lg right-lg h-[52px] w-[52px] items-center justify-center rounded-pill bg-primary"
      >
        <PencilGlyph size={24} tone="white" />
      </Pressable>
    </View>
  );
}
