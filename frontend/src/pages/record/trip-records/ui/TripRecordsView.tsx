import { useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { formatDayLabel } from '@/entities/trip';
import { formatCoPickDayHeader } from '@/features/itinerary/model/draftView';
import {
  GpsOffGlyph,
  InfoCircleGlyph,
  NoteGlyph,
  VisitCheckUpcomingGlyph,
} from '@/features/record/ui/RecordGlyphs';
import { SpontaneousVisitButton } from './SpontaneousVisitButton';
import { VisitRecordCard, type VisitRecordCardVM } from './VisitRecordCard';
import type { MapCenter, MapPin } from '@/shared/map';
import { StateNotice } from '@/shared/ui/StateNotice';
import { DayChipOverlay } from '@/widgets/map-sheet-shell';
import { MapSheetShell } from '@/widgets/map-sheet-shell';

/**
 * TRIP-1085 · j01 방문 기록 **순수 뷰**(pages · 셸 조립) — 전면 지도 + 바텀시트(Figma 4716:2833 — 옛 4705:2756 은 TRIP-1088 교체로 삭제).
 *
 * 셸(`MapSheetShell`)이 지도·좌상단 일차 칩(‹ 포함)·3스냅 시트를 그리고, 이 뷰는 시트 헤더 한 줄과 본문을
 * 채운다. 하단 탭바는 없다(결정 1(b)). 지도는 셸 기본 잠금(결정 2(a)) + 핀 전부 맞추기(결정 3(c)). 핀 판정·
 * 조회·라우팅은 페이지 몫 — 이 파일은 `@/shared/api`·조회 훅을 import 하지 않는다(프리뷰 격리 렌더).
 *
 * 시트 본문은 셸 `list` 경로다 — 카드·계획 행이 리스트 항목, 그 위(`ListHeaderComponent`)에 헤더·GPS 배너·
 * 귀속·안내문·오류/빈 표면, 끝(`ListFooterComponent`)에 [방문 추가]. list 경로를 쓰는 이유는 키보드다:
 * 거기에만 `keyboardShouldPersistTaps="handled"`(키보드가 떠 있어도 첫 탭이 버튼으로 간다)가 걸려 있다 —
 * 메모 입력(`BottomSheetTextInput`)이 이 시트 안에 있다.
 *
 * 카드 사진·메모 실데이터는 페이지가 `renderCard` 로 조립해 내린다(훅이라 항목 안에서 못 부른다). undefined
 * 면 슬롯 없는 기본 `VisitRecordCard`(TRIP-1069 D3). 리스트 key 가 `visitCheckId` 라 방문이 바뀌면 카드가
 * 리마운트돼 메모 초안이 새로 심긴다(seed-once).
 *
 * 계획 행(TRIP-1021)은 레코드 없는 그날 슬롯이다 — `VisitRecordCard` 가 아니다(그 카드는 레코드 id 로
 * [건너뛰기]를 쏘는데 계획 행엔 id 가 없다). `onPressPlanCheck` 가 오면 행에 "방문 체크".
 *
 * ⚠️ 원리적 사각(6-b): 시트 실제 스냅·키보드가 시트를 밀어 올리는지·지도 제스처·핀 모양은 통과형 목이 못 본다.
 */

export interface TripRecordsDayTab {
  day: string;
  label: string;
}

/**
 * TRIP-569 — 활성 일자의 귀속 헤더 완성값(라벨 조립은 페이지 몫). `stayName` 이 있으면 숙소명
 * 줄을 그리고, null/undefined 면 줄이 없다 — 날짜 귀속은 시트 헤더가 맡는다(TRIP-1097).
 */
export interface DayAttributionHeader {
  dayLabel: string;
  stayName?: string | null;
}

/** TRIP-1021 — 방문 레코드가 없는 그날 계획 슬롯 한 행(VisitRecordCard 재사용 금지 — 레코드 id 없음). */
export interface RecordPlanRowVM {
  slotKey: string;
  poiId: string;
  nameKo: string;
}

export interface TripRecordsViewProps {
  /** 시트 헤더 첫 조각. 없거나 빈 문자열이면(여행 조회 실패 포함) 그 조각만 빠진다(INV-4). */
  tripTitle?: string;
  dayTabs: TripRecordsDayTab[];
  activeDay: string;
  onSelectDay: (day: string) => void;
  onPressBack?: () => void;
  mapCenter: MapCenter;
  /** 페이지가 판정한 핀(체크=`done`·번호=`upcoming`). 받은 그대로 셸에 넘긴다. */
  mapPins?: MapPin[];
  cards: VisitRecordCardVM[];
  /** TRIP-569 — 활성 일자의 숙소·날짜 귀속 헤더(없으면 미표시). */
  attribution?: DayAttributionHeader;
  /** TRIP-760 — 안내문(옵셔널). 미주입 시 default 문자열. */
  noticeCopy?: string;
  /** TRIP-759 — 카드별 실데이터 렌더 훅(옵셔널). undefined 를 돌려주면 기본 VisitRecordCard. */
  renderCard?: (card: VisitRecordCardVM) => ReactNode;
  /** TRIP-761 — 수동 체크인 모드(GPS 배너 + 지도 배지 + UPCOMING 카드 "방문 체크", BR-U5-54). */
  manualCheckin?: boolean;
  /** TRIP-761 — UPCOMING 카드 "방문 체크" press(arg = card.poiId). */
  onPressManualCheck?: (poiId: string) => void;
  /** TRIP-1021 — 계획 행(레코드 없는 슬롯). 미주입이면 행 없음. */
  planRows?: RecordPlanRowVM[];
  /** TRIP-1021 — 계획 행 "방문 체크". 주입되면 모드와 무관하게 선다(TRIP-1069 D8). */
  onPressPlanCheck?: (row: RecordPlanRowVM) => void;
  /** TRIP-1021 — 기록 조회 상태. 미주입 = 'ready'. loading 이면 빈 안내 없음, error 면 오류 표면. */
  recordsStatus?: 'ready' | 'loading' | 'error';
  onPressRetryRecords?: () => void;
  onPressComplete: (visitCheckId: string) => void;
  onPressSkip: (visitCheckId: string) => void;
  /** 즉석 방문 추가 — 미주입이면 [방문 추가]를 그리지 않는다(TRIP-939). */
  onPressSpontaneous?: () => void;
  /** TRIP-1088 「오늘의 회고」 FAB — 미주입이면 그리지 않는다(미래·로딩 판정은 페이지 몫). */
  onPressReflection?: () => void;
}

type SheetItem =
  | { kind: 'card'; card: VisitRecordCardVM }
  | { kind: 'plan'; row: RecordPlanRowVM };

const DEFAULT_NOTICE = '오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요';

// TRIP-1088 회고 FAB 앵커 — i01 수정 FAB(LiveHubView, TRIP-1083)와 같은 식·값: FAB 윗변 y =
// max(칩 줄 하단 + 간격, 시트 윗변 − 간격 − FAB). 앵커는 reanimated 컴포넌트라 className 대신 style 숫자
// (토큰 sm 8·lg 16 과 같은 값). 한쪽만 바꾸면 두 FAB 간격이 갈라진다.
const FAB_HEIGHT = 52;
const FAB_GAP = 8;
const FAB_RIGHT = 16;
// 그림자 색은 토큰이 없다 — LiveHubView `FAB_SHADOW` 와 같은 값(Figma 0/4/16 8%).
const FAB_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 4,
} as const;

export function TripRecordsView({
  tripTitle,
  dayTabs,
  activeDay,
  onSelectDay,
  onPressBack,
  mapCenter,
  mapPins,
  cards,
  attribution,
  noticeCopy,
  renderCard,
  manualCheckin,
  onPressManualCheck,
  planRows = [],
  onPressPlanCheck,
  recordsStatus = 'ready',
  onPressRetryRecords,
  onPressComplete,
  onPressSkip,
  onPressSpontaneous,
  onPressReflection,
}: TripRecordsViewProps): ReactElement {
  const activeIndex = dayTabs.findIndex((tab) => tab.day === activeDay);
  const { height: windowHeight } = useWindowDimensions();
  // 시트 윗변 y — 셸이 gorhom 에 넘기면 gorhom 이 매 프레임(끄는 중에도) 써 넣는다(topInset 포함이라
  // safeTop 을 더하지 않는다). 첫 값 전엔 창 높이 — FAB 가 화면 아래에서 시작한다(상단 튐 방지, 6-b).
  const sheetTop = useSharedValue(windowHeight);
  // 칩 줄(‹ + 일차 칩) 하단 — onLayout 실측. 재기 전엔 0.
  const [overlayBottom, setOverlayBottom] = useState(0);
  const fabAnchorStyle = useAnimatedStyle(() => ({
    top: Math.max(
      overlayBottom + FAB_GAP,
      sheetTop.value - FAB_GAP - FAB_HEIGHT
    ),
  }));

  // i01 헤더와 같은 조립(LiveHubView) — 'N곳' 은 시트에 보이는 곳 수(카드 + 계획 행, 01b Q2).
  const header = [
    tripTitle ?? '',
    activeIndex >= 0 ? formatDayLabel(activeIndex + 1) : '',
    formatCoPickDayHeader(activeDay),
    `${cards.length + planRows.length}곳`,
  ]
    .filter((piece) => piece !== '')
    .join(' · ');

  const items: SheetItem[] = [
    ...cards.map((card) => ({ kind: 'card' as const, card })),
    ...planRows.map((row) => ({ kind: 'plan' as const, row })),
  ];

  const renderItem = ({ item }: { item: SheetItem }): ReactElement => (
    <View className="px-lg pb-md">
      {item.kind === 'card'
        ? (renderCard?.(item.card) ?? (
            <VisitRecordCard
              card={item.card}
              manualCheckin={manualCheckin}
              onPressManualCheck={onPressManualCheck}
              onPressComplete={onPressComplete}
              onPressSkip={onPressSkip}
            />
          ))
        : renderPlanRow(item.row, onPressPlanCheck, manualCheckin)}
    </View>
  );

  return (
    <View testID="record-trip-view" className="flex-1">
      <MapSheetShell
        center={mapCenter}
        pins={mapPins}
        fitPins
        // TRIP-1088 — 셸 기본 칩 줄을 뷰가 직접 넘긴다: FAB 하한을 재려면 칩 줄에 onLayout 을 걸어야 하는데
        // 셸 기본 오버레이엔 그 자리가 없다. ⚠️ 셸 기본 오버레이 배선의 사본 — 셸이 기본을 바꾸면 j01 만 남는다.
        overlay={
          <View
            testID="record-trip-overlay-row"
            onLayout={(event) => {
              const { y, height } = event.nativeEvent.layout;
              setOverlayBottom(y + height);
            }}
          >
            <DayChipOverlay
              days={dayTabs.map((tab) => ({ label: tab.label }))}
              selectedIndex={activeIndex}
              onSelectDay={(index) => {
                const tab = dayTabs[index];
                if (tab) onSelectDay(tab.day);
              }}
              onBack={onPressBack ?? (() => {})}
            />
          </View>
        }
        animatedPosition={sheetTop}
        // TRIP-761 ⊘ 배지 — 셸 `mapCard` 슬롯(일차 칩 줄 아래, Figma 4705:3557 y=63). 지도 위에 직접
        // absolute 로 얹지 않는다(repo-traps 지도 절). testID 노드 자신이 `pointerEvents="none"` 라 지도
        // 터치를 흡수하지 않는다(A3a — jest 가 볼 수 있는 유일한 그물, 실제 통과는 6-b).
        mapCard={
          manualCheckin ? (
            <View
              testID="record-map-gps-off"
              pointerEvents="none"
              className="mt-sm flex-row items-center gap-[6px] self-start rounded-[8px] border-[1.2px] border-dashed border-muted-soft bg-canvas/90 px-[10px] py-[6px]"
            >
              <GpsOffGlyph size={15} />
              <Text className="text-micro text-muted">GPS 자동기록 꺼짐</Text>
            </View>
          ) : undefined
        }
        header={
          <View className="px-lg pt-[10px]">
            <Text
              testID="record-trip-sheet-header"
              className="font-noto-bold text-card-title text-ink"
            >
              {header}
            </Text>
          </View>
        }
        list={{
          data: items,
          renderItem,
          keyExtractor: (item) =>
            item.kind === 'card'
              ? item.card.visitCheckId
              : `plan-${item.row.slotKey}`,
          ListFooterComponent: (
            <View className="px-lg pb-[76px]">
              {onPressSpontaneous ? (
                <SpontaneousVisitButton onPress={onPressSpontaneous} />
              ) : null}
            </View>
          ),
        }}
      >
        <View className="gap-md px-lg pb-md pt-md">
          {/* TRIP-761 GPS 미동의 배너 — 수동 체크인 모드에서만. 헤더 바로 아래(Figma 4705:3557).
              카피는 사용자 가시 문자열이라 자구가 계약(BR-U5-54). */}
          {manualCheckin ? (
            <View
              testID="record-gps-banner"
              className="w-full flex-row items-start gap-[10px] rounded-button border-[1.3px] border-dashed border-hairline-strong bg-surface-soft px-[13px] py-md"
            >
              <InfoCircleGlyph size={20} />
              <View className="flex-1 gap-[3px]">
                <Text className="font-noto-bold text-label text-ink">
                  GPS 미동의 — 수동 체크인으로 기록해요
                </Text>
                <Text className="text-caption text-muted">
                  위치 권한이 없어 좌표·이동 경로는 자동 기록되지 않아요. 방문한
                  장소를 직접 선택해 기록하세요.
                </Text>
              </View>
            </View>
          ) : null}

          {/* TRIP-569 숙소 귀속 줄 — 숙소 있는 날만. 숙소 없는 날의 날짜 귀속(BR-U5-26)은 시트 헤더가
              맡는다(TRIP-1097 결정 1 — 옛 date-only 줄은 헤더의 "N일차"를 한 번 더 찍었다). */}
          {attribution?.stayName ? (
            <View
              testID="record-trip-attribution-stay"
              className="w-full flex-row items-center gap-sm"
            >
              <Text className="font-noto-bold text-body text-ink">
                {attribution.stayName}
              </Text>
              <Text className="text-label text-muted">
                {attribution.dayLabel}
              </Text>
            </View>
          ) : null}

          <Text className="w-full text-label text-muted">
            {noticeCopy ?? DEFAULT_NOTICE}
          </Text>

          {recordsStatus === 'error' ? (
            <StateNotice
              testID="record-trip-error"
              illustration={
                <View className="h-[72px] w-[72px] rounded-full bg-surface-soft" />
              }
              title="기록을 불러오지 못했어요"
              description="잠시 후 다시 시도해 주세요"
              actions={[
                {
                  testID: 'record-trip-error-retry',
                  label: '다시 시도',
                  variant: 'outline',
                  onPress: onPressRetryRecords,
                },
              ]}
            />
          ) : recordsStatus === 'ready' && cards.length === 0 ? (
            <Text
              testID="record-trip-empty"
              className="w-full py-sm text-center text-label text-muted"
            >
              아직 방문 기록이 없어요
            </Text>
          ) : null}
        </View>
      </MapSheetShell>

      {/* TRIP-1088 「오늘의 회고」 FAB — 시트 윗변 8 위 오른쪽 16 에 붙어 시트를 따라가고, 펼침에선 칩 줄
          아래에서 멈춘다(Figma 4716:2946). 셸 뒤 형제라 셸 안(원점 어긋남)·mapCard(iOS 부모 밖 터치 막힘)가
          아니다(TRIP-1083). 배치 className 은 안쪽 Pressable 에만 둔다(앵커는 reanimated 컴포넌트). */}
      {onPressReflection ? (
        <Animated.View
          testID="record-trip-reflection-fab-anchor"
          pointerEvents="box-none"
          style={[{ position: 'absolute', right: FAB_RIGHT }, fabAnchorStyle]}
        >
          <Pressable
            testID="record-trip-reflection-fab"
            accessibilityRole="button"
            onPress={onPressReflection}
            style={FAB_SHADOW}
            className="h-[52px] flex-row items-center gap-sm rounded-pill bg-primary px-xl"
          >
            <NoteGlyph />
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              오늘의 회고
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** 계획 행 — 빈 원 + 이름 + (오늘 탭이면) "방문 체크" pill. 사진·메모 칸은 레코드가 생긴 뒤에만 있다. */
function renderPlanRow(
  row: RecordPlanRowVM,
  onPressPlanCheck: ((row: RecordPlanRowVM) => void) | undefined,
  manualCheckin: boolean | undefined
): ReactElement {
  return (
    <View
      testID={`record-trip-plan-row-${row.slotKey}`}
      className="w-full gap-md rounded-card border border-hairline bg-canvas px-[15px] py-[14px]"
    >
      <View className="flex-row items-center gap-sm">
        <VisitCheckUpcomingGlyph size={22} />
        <Text className="font-noto-bold text-card-title text-ink">
          {row.nameKo}
        </Text>
      </View>
      {onPressPlanCheck ? (
        <View className="flex-row items-center gap-[10px]">
          <Pressable
            testID={`record-trip-plan-check-${row.slotKey}`}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => onPressPlanCheck(row)}
            className="flex-row items-center rounded-[8px] bg-primary px-[15px] py-sm"
          >
            <Text className="font-noto-bold text-label text-white">
              방문 체크
            </Text>
          </Pressable>
          {/* 수동 체크인 문맥 문구 — 권한이 있는 사용자에겐 뜻이 안 맞아 뺀다(03b N4). */}
          {manualCheckin ? (
            <Text className="text-caption text-muted">
              좌표 없이 장소 직접 선택
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
