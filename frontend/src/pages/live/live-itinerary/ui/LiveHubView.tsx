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
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/index.schemas';
import type { MapCenter } from '@/shared/map';
import { MapSheetShell } from '@/widgets/map-sheet-shell';
import { BackChevronGlyph, FullAiGlyph } from '@/widgets/map-sheet-shell';
import { formatCoPickDayHeader } from '@/features/itinerary/index.view';
import { PencilGlyph } from '@/features/itinerary/index.view';
import { CloseGlyph } from '@/features/home';
import {
  RailActiveGlyph,
  RailDoneGlyph,
  RailUpcomingGlyph,
} from '@/features/execution/index.view';
import { buildSlotKey } from '@/entities/itinerary-slot';
import {
  buildStatePins,
  type SlotProgressState,
} from '@/entities/itinerary-slot';
import { SlotProgressCard } from '@/entities/itinerary-slot';

/**
 * TRIP-746 · i01 여행중 허브 **순수 뷰**(pages · api import 0 — preview 가 직접 import, TRIP-610).
 * 전면 지도(셸, 조작 가능) 위 좌상단 뒤로가기 + 일자 칩, 3스냅 시트(헤더 한 줄 + 레일 타임라인 +
 * 카드 3상태), 시트 윗변 오른쪽을 따라가는 "일정 수정" 연필 FAB(TRIP-1083). 조회·판정·라우팅은
 * 페이지(LiveItineraryPage) 몫이고,
 * 이 뷰가 가진 상태는 수정 알약 메뉴 열림(TRIP-747 — FAB 는 제자리 토글, 이동은 알약이 한다),
 * 트리거 알약 로컬 숨김(TRIP-748 D3) 둘이다. [사진]·[메모]는 페이지가 콜백을 줄 때만 관람 중 카드에
 * 넘긴다(TRIP-1070 · 미주입이면 그리지 않는다 — TRIP-939).
 *
 * 트리거 알약 숨김은 **명시 열거 경로**로만 부른다 — 시트 본문 스크롤 시작 · 시트 스냅 이동(마운트
 * `-1→n` 제외) · 지도 탭 · 일자 칩/FAB/[방문 완료]. 루트 터치 캡처·투명 백드롭은 쓰지
 * 않는다(알약 자기 press 까지 먹고, HP9 "바깥 탭으로 메뉴 안 닫힘"과 충돌). 서버 호출 없음.
 *
 * ⚠️ 원리적 사각(6-b): 3스냅 실전환·스냅별 보임·FAB 가림·지도 제스처 실해제·드래그 중 FAB 실추종·
 * 마운트 첫 프레임 FAB 자리는 jest 가 못 본다.
 */

// 닫힘(핸들만 28px) · 중간 55%(Figma 4702:2688 · 4702:2833). 펼침은 기기마다 계산한다(아래).
const CLOSED_SNAP = 28;
const HALF_SNAP = '55%';
// 펼침 시트 윗변 = 지도 오버레이 줄 윗변 + 104(Figma 4702:2982 — 오버레이 줄 y≈18 → 시트 y=122).
// 오버레이 줄 윗변은 셸이 정한다: 세이프에어리어 top + 셸 `pt-sm`(8). 비율(%)로 두면 상태바가 큰
// 기기에서 시트가 뒤로가기·일자 칩·트리거 알약을 덮는다(TRIP-748 03b 경고-2).
const OVERLAY_ROW_TOP_PAD = 8;
const EXPANDED_GAP_BELOW_OVERLAY_ROW = 104;
// 수정 FAB 앵커(TRIP-1083, Figma 4702:2688·2833·2982·3131) — FAB 윗변 y =
// max(오버레이 줄 하단 + 간격, 시트 윗변 − 간격 − FAB). 앵커는 reanimated 컴포넌트라 className(NativeWind)
// 이 기기에서 적용된다는 근거가 없어 style 숫자로 둔다 — 값은 토큰 sm(8)·lg(16)과 같다.
const FAB_SIZE = 52;
const FAB_GAP = 8;
const FAB_RIGHT = 16;
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
// 열린 FAB(×)·알약은 그림자가 다르다(Figma 4702:3131).
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
  /** active 카드 [사진]·[메모](TRIP-1070). 미주입이면 그 버튼이 없다. */
  onPressPhoto?: () => void;
  onPressMemo?: () => void;
  /** active 카드 사진 안내 한 줄 — 상태는 페이지가 가진다. */
  photoNotice?: string | null;
  /** TRIP-1117 — active 카드 메모 안내 한 줄(시트가 닫힌 뒤 도착한 저장 실패, Q3). 상태는 페이지가 가진다. */
  memoNotice?: string | null;
  /** TRIP-1117 — 메모 시트가 열린 동안 수정 FAB 를 숨긴다(Figma 4741:2833). 앵커 자리(HF8)는 그대로. */
  fabHidden?: boolean;
  /** 트리거 알약(TRIP-748) — 지도 위 일자 칩 아래(셸 `mapCard`)에 그린다. */
  triggerChip?: ReactNode;
  /** 알약이 가리키는 트리거 id — 이 키를 숨겼으면 알약을 안 그리고, 키가 바뀌면 다시 보인다. */
  triggerPillKey?: string;
  /** 슬롯별 영향 배지 글자(TRIP-748) — 값을 주면 upcoming 카드의 "예정" 자리에 분홍 배지로. */
  slotBadgeLabel?: (slotKey: string) => string | null | undefined;
  /** TRIP-987 — 슬롯 이름·'›' 진입(i10). 미주입이면 어느 카드에도 '›' 가 없다(TRIP-939). */
  onPressSlotName?: (poiId: string) => void;
  /** TRIP-1021 — 예정 카드 수동 [도착](arg = poiId). active 슬롯이 있으면 어느 카드에도 안 넘긴다. */
  onPressArrive?: (poiId: string) => void;
  /** TRIP-1189 — 다음 예정지(첫 upcoming + 유한 좌표) 한 곳의 [길찾기]. 페이지가 resolveNextDest 로 고른 poiId — 없으면 어느 카드에도 안 그린다. */
  directionsPoiId?: string | null;
  onPressDirections?: () => void;
  /** TRIP-1189 — 앱·웹 모두 실패했을 때 그 카드 아래 거리 안내(INV-4). */
  directionsNotice?: string | null;
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
  onPressPhoto,
  onPressMemo,
  photoNotice,
  memoNotice,
  fabHidden = false,
  triggerChip,
  triggerPillKey,
  slotBadgeLabel,
  onPressSlotName,
  onPressArrive,
  directionsPoiId,
  onPressDirections,
  directionsNotice,
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
  // 시트 윗변 y — 셸이 gorhom 에 넘기면 gorhom 이 매 프레임(끄는 중에도) 써 넣는다. gorhom 이 이미
  // topInset 을 더해 LiveHubView 루트 기준 y 를 주므로 safeTop 을 다시 더하지 않는다. 첫 값이 들어오기
  // 전엔 gorhom 내부 초기값과 같은 창 높이로 둬 FAB 가 화면 아래쪽에서 시작한다(상단 튐 방지, 6-b).
  const sheetTop = useSharedValue(windowHeight);
  // 오버레이 줄(뒤로+일자 칩) 하단 — onLayout 실측(계산 사본 아님). 재기 전엔 0.
  const [overlayBottom, setOverlayBottom] = useState(0);
  // useAnimatedStyle = sheetTop 이 바뀔 때마다 리렌더 없이 UI 스레드에서 스타일을 다시 계산하는 훅.
  const fabAnchorStyle = useAnimatedStyle(() => ({
    top: Math.max(overlayBottom + FAB_GAP, sheetTop.value - FAB_GAP - FAB_SIZE),
  }));
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
  // 진행 중 슬롯이 있으면 어느 카드에도 [도착]을 안 준다(Q1) — 진행 도출은 active 를 하나만 인정해,
  // 다른 곳에 도착하면 앞 슬롯이 '예정'으로 되돌아 보이고 거기서 다시 누르면 409 가 난다.
  const arrive = slots.some(({ state }) => state === 'active')
    ? undefined
    : onPressArrive;

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
    <View
      testID="execution-live-overlay-row"
      onLayout={(event) => {
        const { y, height } = event.nativeEvent.layout;
        setOverlayBottom(y + height);
      }}
      className="flex-row items-center gap-sm"
    >
      <Pressable
        testID="execution-live-back"
        accessibilityRole="button"
        accessibilityLabel="뒤로"
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
            accessibilityRole="button"
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
        animatedPosition={sheetTop}
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
                    onPressPhoto={state === 'active' ? onPressPhoto : undefined}
                    onPressMemo={state === 'active' ? onPressMemo : undefined}
                    photoNotice={state === 'active' ? photoNotice : undefined}
                    memoNotice={state === 'active' ? memoNotice : undefined}
                    badgeLabel={slotBadgeLabel?.(slotKey) ?? undefined}
                    onPressName={
                      onPressSlotName
                        ? () => onPressSlotName(slot.poiId)
                        : undefined
                    }
                    onPressArrive={
                      arrive ? () => arrive(slot.poiId) : undefined
                    }
                    onPressDirections={
                      state === 'upcoming' && slot.poiId === directionsPoiId
                        ? onPressDirections
                        : undefined
                    }
                    directionsNotice={
                      slot.poiId === directionsPoiId
                        ? directionsNotice
                        : undefined
                    }
                  />
                </View>
              </View>
            );
          })}
        </View>
      </MapSheetShell>

      {/* 일정 수정 FAB + 수정 알약 — 시트 윗변 8 위 오른쪽에 붙어 시트와 함께 움직이고, 펼침에서는
          오버레이 줄 아래에서 멈춘다(TRIP-1083). 알약은 FAB 왼쪽 가로 한 줄(Figma 4702:3131). 딤이 없고
          바깥 탭으로 닫지 않는다(× 또는 알약으로만, Seed ③) — 빈 칸은 box-none 이라 아래 시트로 터치가 간다.
          배치 className 은 안쪽 일반 View 에만 둔다(앵커는 reanimated 컴포넌트).
          메모 시트가 열린 동안(fabHidden)은 앵커째 빠진다(TRIP-1117, Figma 4741:2833) — 자리는 그대로 루트 직속. */}
      {fabHidden ? null : (
        <Animated.View
          testID="execution-live-fab-anchor"
          pointerEvents="box-none"
          style={[{ position: 'absolute', right: FAB_RIGHT }, fabAnchorStyle]}
        >
          <View
            pointerEvents="box-none"
            className="flex-row items-center gap-sm"
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
                <CloseGlyph
                  size={26}
                  testID="execution-live-replan-fab-close"
                />
              ) : (
                <PencilGlyph
                  size={24}
                  tone="white"
                  testID="execution-live-replan-fab-pencil"
                />
              )}
            </Pressable>
          </View>
        </Animated.View>
      )}
    </View>
  );
}
