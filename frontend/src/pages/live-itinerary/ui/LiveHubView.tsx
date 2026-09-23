import {
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import type { MapCenter } from '@/shared/map';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';
import {
  BackChevronGlyph,
  FullAiGlyph,
} from '@/widgets/map-sheet-shell/ui/MapSheetGlyphs';
import { formatCoPickDayHeader } from '@/features/itinerary/model/draftView';
import { PencilGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';
import { CloseGlyph } from '@/features/home/ui/HomeGlyphs';
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
 * 이 뷰가 가진 상태는 수정 알약 메뉴 열림(TRIP-747 — FAB 는 제자리 토글, 이동은 알약이 한다),
 * 트리거 알약 로컬 숨김(TRIP-748 D3) 둘이다. [사진]·[메모]는 카드에 `onPressSoon` 을 안 넘겨 그리지
 * 않는다(TRIP-939 — 기능 개통 시 넘기면 되살아난다).
 *
 * 트리거 알약 숨김은 **명시 열거 경로**로만 부른다 — 시트 본문 스크롤 시작 · 시트 스냅 이동(마운트
 * `-1→n` 제외) · 지도 탭 · 일자 칩/FAB/[방문 완료]. 루트 터치 캡처·투명 백드롭은 쓰지
 * 않는다(알약 자기 press 까지 먹고, HP9 "바깥 탭으로 메뉴 안 닫힘"과 충돌). 서버 호출 없음.
 *
 * ⚠️ 원리적 사각(6-b): 3스냅 실전환·스냅별 보임·FAB 가림·지도 제스처 실해제는 jest 가 못 본다.
 */

// 닫힘(핸들만 28px) · 중간 55%(Figma 4251:2448 · 4251:2640). 펼침은 기기마다 계산한다(아래).
const CLOSED_SNAP = 28;
const HALF_SNAP = '55%';
// 펼침 시트 윗변 = 지도 오버레이 줄 윗변 + 104(Figma 4125:3957 — 오버레이 줄 y≈18 → 시트 y=122).
// 오버레이 줄 윗변은 셸이 정한다: 세이프에어리어 top + 셸 `pt-sm`(8). 비율(%)로 두면 상태바가 큰
// 기기에서 시트가 뒤로가기·일자 칩·트리거 알약을 덮는다(TRIP-748 03b 경고-2).
const OVERLAY_ROW_TOP_PAD = 8;
const EXPANDED_GAP_BELOW_OVERLAY_ROW = 104;
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
// 열린 FAB(×)·알약은 그림자가 다르다(Figma 4055:2632 · 4055:2639).
const FAB_OPEN_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.22,
  shadowRadius: 8,
  elevation: 6,
} as const;
const PILL_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.16,
  shadowRadius: 9,
  elevation: 5,
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
  /** [AI에게 맡기기] 알약 — 수동 재계획 진입(BR-U4-10). */
  onPressAiReplan: () => void;
  /** [직접 수정] 알약 — 수동 편집 진입(US-PLANB-12). */
  onPressManualEdit: () => void;
  /** 수정 알약 메뉴 초기 열림(프리뷰 입구). 이후 열림은 뷰가 스스로 든다. */
  initialEditMenuOpen?: boolean;
  /** active 카드 [방문 완료]. */
  onPressComplete?: () => void;
  /** 트리거 알약(TRIP-748) — 지도 위 일자 칩 아래(셸 `mapCard`)에 그린다. */
  triggerChip?: ReactNode;
  /** 알약이 가리키는 트리거 id — 이 키를 숨겼으면 알약을 안 그리고, 키가 바뀌면 다시 보인다. */
  triggerPillKey?: string;
  /** 슬롯별 영향 배지 글자(TRIP-748) — 값을 주면 upcoming 카드의 "예정" 자리에 분홍 배지로. */
  slotBadgeLabel?: (slotKey: string) => string | null | undefined;
}

// 레일 점의 행 상단 여백 — 점 크기(18·16·12)가 달라 Figma 에서 상태마다 다르다(rail 인스턴스 y 실측).
const RAIL_TOP: Record<SlotProgressState, string> = {
  done: 'pt-[11px]',
  active: 'pt-[6px]',
  upcoming: 'pt-[8px]',
};

function EditPill({
  testID,
  icon,
  label,
  onPress,
}: {
  testID: string;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={PILL_SHADOW}
      className="flex-row items-center gap-sm rounded-pill border border-hairline-strong bg-canvas py-md pl-lg pr-[18px]"
    >
      {icon}
      <Text className="font-noto-bold text-body font-bold text-ink">
        {label}
      </Text>
    </Pressable>
  );
}

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
  onPressAiReplan,
  onPressManualEdit,
  initialEditMenuOpen = false,
  onPressComplete,
  triggerChip,
  triggerPillKey,
  slotBadgeLabel,
}: LiveHubViewProps): ReactElement {
  // Provider 없는 렌더(jest)에서는 null — useSafeAreaInsets 는 throw 하므로 컨텍스트를 직접 읽는다.
  const safeTop = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const { height: windowHeight } = useWindowDimensions();
  const expandedSnap =
    windowHeight -
    (safeTop + OVERLAY_ROW_TOP_PAD + EXPANDED_GAP_BELOW_OVERLAY_ROW);
  const snapPoints = useMemo(
    () => [CLOSED_SNAP, HALF_SNAP, expandedSnap],
    [expandedSnap]
  );
  const expandedSnapIndex = snapPoints.length - 1;
  const [editMenuOpen, setEditMenuOpen] = useState(initialEditMenuOpen);
  // "어느 트리거를 숨겼나"를 키로 든다 — 새 트리거(다른 키)가 오면 비교가 저절로 풀려 다시 보인다.
  // 숨김은 editMenuOpen 을 건드리지 않는다(HP9 공존).
  // 키를 안 주면 '' 한 키로 본다(한 번 숨기면 계속 숨김).
  const pillKey = triggerPillKey ?? '';
  const [hiddenPillKey, setHiddenPillKey] = useState<string | null>(null);
  const hidePill = () => setHiddenPillKey(pillKey);
  // 알약은 메뉴를 닫고 나서 이동한다 — 뒤로 돌아왔을 때 열린 채 남지 않게(Seed ②).
  const pickEdit = (go: () => void) => () => {
    setEditMenuOpen(false);
    go();
  };
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
            onPress={() => {
              hidePill();
              onSelectDay(index);
            }}
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
        snapPoints={snapPoints}
        initialIndex={initialSnapIndex}
        mapCard={hiddenPillKey === pillKey ? undefined : triggerChip}
        onMapTap={hidePill}
        onSheetScrollBeginDrag={hidePill}
        onSheetAnimate={(from, to) => {
          // 마운트 애니메이션(-1→초기 스냅)·제자리는 사용자 동작이 아니다 — 알약이 뜨자마자 사라지지 않게.
          // 펼침에서 출발한 끌기도 숨기지 않는다 — 펼침은 알약을 덮고 있어, 내려오는 끌기가 알약을
          // 처음 드러내는 동작이다(03b 경고-2 (나)).
          if (from >= 0 && from !== to && from !== expandedSnapIndex)
            hidePill();
        }}
        header={
          <View className="px-lg">
            <Text
              testID="execution-live-sheet-header"
              className="font-noto-bold text-card-title font-bold text-ink"
            >
              {header}
            </Text>
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
                      state === 'active'
                        ? () => {
                            hidePill();
                            onPressComplete?.();
                          }
                        : undefined
                    }
                    badgeLabel={slotBadgeLabel?.(slotKey) ?? undefined}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </MapSheetShell>

      {/* 일정 수정 FAB + 수정 알약 — 시트와 무관하게 우하단 고정(시트 위에 뜬다). 딤이 없고 바깥
          탭으로 닫지 않는다(× 또는 알약으로만, Seed ③) — 빈 칸은 box-none 이라 아래 시트로 터치가 간다. */}
      <View
        pointerEvents="box-none"
        className="absolute bottom-lg right-lg items-end gap-md"
      >
        {editMenuOpen ? (
          <>
            <EditPill
              testID="execution-live-edit-pill-ai"
              icon={<FullAiGlyph />}
              label="AI에게 맡기기"
              onPress={pickEdit(onPressAiReplan)}
            />
            <EditPill
              testID="execution-live-edit-pill-manual"
              icon={<PencilGlyph size={18} tone="primary" />}
              label="직접 수정"
              onPress={pickEdit(onPressManualEdit)}
            />
          </>
        ) : null}
        <Pressable
          testID="execution-live-replan-fab"
          accessibilityRole="button"
          accessibilityLabel={editMenuOpen ? '닫기' : '일정 수정'}
          onPress={() => {
            hidePill();
            setEditMenuOpen((open) => !open);
          }}
          style={editMenuOpen ? FAB_OPEN_SHADOW : FAB_SHADOW}
          className="h-[52px] w-[52px] items-center justify-center rounded-pill bg-primary"
        >
          {editMenuOpen ? (
            <CloseGlyph size={26} testID="execution-live-replan-fab-close" />
          ) : (
            <PencilGlyph
              size={24}
              tone="white"
              testID="execution-live-replan-fab-pencil"
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}
