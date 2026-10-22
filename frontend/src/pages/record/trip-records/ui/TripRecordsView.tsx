import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatDayLabel } from '@/entities/trip';
import { formatCoPickDayHeader } from '@/features/itinerary/index.view';
import {
  GpsOffGlyph,
  InfoCircleGlyph,
  VisitCheckUpcomingGlyph,
} from '@/features/record';
import { SpontaneousVisitButton } from './SpontaneousVisitButton';
import {
  PlanOrderBadge,
  VisitRecordCard,
  type VisitRecordCardVM,
} from './VisitRecordCard';
import type { MapCenter, MapPin } from '@/shared/map';
import { StateNotice } from '@/shared/ui/StateNotice';
import { NAV_BAR_RESERVE, RecordNavBar } from '@/widgets/bottom-nav-bar';
import { MapSheetShell } from '@/widgets/map-sheet-shell';

/**
 * TRIP-1085 · j01 방문 기록 **순수 뷰**(pages · 셸 조립) — 전면 지도 + 바텀시트(Figma 4716:2833 — 옛 4705:2756 은 TRIP-1088 교체로 삭제).
 *
 * 셸(`MapSheetShell`)이 지도·좌상단 일차 칩(‹ 포함)·3스냅 시트를 그리고, 이 뷰는 시트 헤더 한 줄과 본문을
 * 채운다. 앱 하단 탭바는 없다(결정 1(b)) — 대신 TRIP-1557 의 **허브식 하단 바**(뒤로 + 기록·회고·요약)가 시트 위에 떠 있다. 지도는 셸 기본 잠금(결정 2(a)) + 핀 전부 맞추기(결정 3(c)). 핀 판정·
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
  /** TRIP-1558 — 그날 계획 슬롯 위치+1(= 지도 핀 번호). */
  planOrder?: number;
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
  /** TRIP-1557 하단 바 「회고」 칸(옛 TRIP-1088 FAB) — 미주입이면 칸이 비활성이다(미래·로딩 판정은 페이지 몫). */
  onPressReflection?: () => void;
  /** TRIP-1557 하단 바 「요약」 칸 — 미주입이면 칸이 비활성이다(요약 준비 여부 판정은 페이지 몫). */
  onPressSummary?: () => void;
  /** TRIP-1520 — 그날 실제 경로 세그먼트. 주면 계획 동선 위에 늘 겹친다(토글 없음, BR-U10-41 개정). */
  actualRoute?: MapCenter[][];
}

type SheetItem =
  | { kind: 'card'; card: VisitRecordCardVM }
  | { kind: 'plan'; row: RecordPlanRowVM };

const DEFAULT_NOTICE = '오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요';

// 핀 탭이 올려 두는 최상단 칸(j01 기본 배열 0 닫힘·1 peek·2 펼침) — gorhom 은 이 칸에서만 안쪽 스크롤을 허용한다.
const TOP_SNAP = 2;
// TRIP-1557 시트 칸 — 닫힘 칸이 **하단 바(70) 위로 핸들(28)이 나오게** 98 이상이어야 한다(안 그러면 핸들이 바 뒤로 숨어 시트를 되올릴 손잡이가
// 사라진다 — jest 는 통과형 목이라 값을 못 본다, 6-b·코드 리뷰 몫). 셸 기본 배열은 28+하단 안전영역이라 바를 모른다 — 그래서 직접 준다.
// 칸 번호는 그대로(0 닫힘·1 peek·2 펼침 — TOP_SNAP·`initialIndex` 가 이 번호에 걸려 있다).
const CLOSED_HANDLE_HEIGHT = 28;
const SNAP_POINTS = [NAV_BAR_RESERVE + CLOSED_HANDLE_HEIGHT, '45%', '88%'];
// 리스트 맨 아래 [방문 추가] 가 바에 가리지 않게 — 바 점유 + 여백 16(옛 76 은 바가 없던 때 값).
const LIST_BOTTOM_GAP = 16;
const noop = (): void => {};

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
  onPressSummary,
  actualRoute,
}: TripRecordsViewProps): ReactElement {
  const activeIndex = dayTabs.findIndex((tab) => tab.day === activeDay);
  // TRIP-1558 — 핀 탭 → 시트를 최상단 칸으로 올리고, **도착한 뒤** 그 번호의 항목으로 스크롤. gorhom 은 가장 높은 칸에서만 안쪽 스크롤을
  // 허용한다(6-b 실측). j01 기본 배열: 0 닫힘·1 peek·2 펼침(i01 허브의 −1/0/1 과 번호가 다르다). 도착한 칸은 셸 `onSheetChange` 로
  // 추적한다(초기값 = peek 1). 요청은 id 요청형이라 같은 핀을 다시 눌러도 다시 나간다.
  const arrivedIndexRef = useRef(1);
  // 올라가는 동안 마지막으로 누른 핀의 항목 index — 도착하면 스크롤로 승격하고 비운다.
  const pendingItemRef = useRef<number | undefined>(undefined);
  const [snapRequest, setSnapRequest] = useState<
    { index: number; id: number } | undefined
  >(undefined);
  const [scrollRequest, setScrollRequest] = useState<
    { index: number; id: number } | undefined
  >(undefined);
  const requestScroll = (index: number): void =>
    setScrollRequest((prev) => ({ index, id: (prev?.id ?? 0) + 1 }));

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

  // `onPinTap(index)` 의 index 는 mapPins 위치다 — 항목과는 pins[index].number(= 슬롯 위치+1 = planOrder)로 잇는다. 카드가 계획 행보다 앞이라
  // 같은 번호면 카드가 먼저 걸린다. 항목이 없으면(로딩·결번) 아무것도 안 한다.
  const handlePinTap = (pinIndex: number): void => {
    const number = mapPins?.[pinIndex]?.number;
    const itemIndex = items.findIndex(
      (item) =>
        (item.kind === 'card' ? item.card.planOrder : item.row.planOrder) ===
        number
    );
    if (number === undefined || itemIndex < 0) return;
    if (arrivedIndexRef.current === TOP_SNAP) {
      requestScroll(itemIndex);
      return;
    }
    pendingItemRef.current = itemIndex;
    setSnapRequest((prev) => ({ index: TOP_SNAP, id: (prev?.id ?? 0) + 1 }));
  };

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
        actualRoute={actualRoute}
        // TRIP-1204 — 시트가 열린 채로도 손가락 확대·이동(셸 기본은 열림=잠금). 6-b 실기 전용.
        mapViewOnly={false}
        // 일차 칩 줄은 셸 기본을 쓴다. 뒤로는 좌상단 ‹ 가 아니라 하단 바로 옮겼다(TRIP-1557).
        days={dayTabs.map((tab) => ({ label: tab.label }))}
        selectedDayIndex={activeIndex}
        onSelectDay={(index) => {
          const tab = dayTabs[index];
          if (tab) onSelectDay(tab.day);
        }}
        hideBack
        snapPoints={SNAP_POINTS}
        initialIndex={1}
        // 이동 시작이 최상단이 아니면 사용자가 시트를 다른 칸으로 끌어 간 것 — 대기 요청을 버린다(나중에 손으로 펼칠 때 옛 항목으로 튀지 않게).
        onSheetAnimate={(_from, to) => {
          if (to !== TOP_SNAP) pendingItemRef.current = undefined;
        }}
        onSheetChange={(index) => {
          arrivedIndexRef.current = index;
          const itemIndex = pendingItemRef.current;
          if (index !== TOP_SNAP || itemIndex === undefined) return;
          pendingItemRef.current = undefined;
          requestScroll(itemIndex);
        }}
        onPinTap={handlePinTap}
        snapRequest={snapRequest}
        scrollRequest={scrollRequest}
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
            <View
              className="px-lg"
              style={{ paddingBottom: NAV_BAR_RESERVE + LIST_BOTTOM_GAP }}
            >
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
                  위치 권한 없음 — 수동 체크인으로 기록해요
                </Text>
                <Text className="text-caption text-muted">
                  위치 권한이 없어 좌표·이동 경로는 자동 기록되지 않아요. 방문한
                  장소를 직접 선택해 기록해요.
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

      {/* TRIP-1557 하단 바 → TRIP-1584 공용 `RecordNavBar`(허브와 같은 변신 모션). 셸 뒤 형제라 시트 위에 얹힌다(시트 안·셸 오버레이 슬롯이 아니다). 시트가
          어디 있든 똑같다. 키보드 표시 중엔 바가 스스로 빠진다(TRIP-1280). 비활성은 칸이 지는 신호: 회고 = 미래·로딩 판정(페이지), 요약 = 서버 ready(페이지) —
          뷰는 콜백 유무만 본다. */}
      <RecordNavBar
        testIDPrefix="record-trip-bottom-bar"
        active="records"
        onBack={onPressBack ?? noop}
        onPressReflection={onPressReflection}
        onPressSummary={onPressSummary}
      />
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
        {row.planOrder != null ? (
          <PlanOrderBadge
            testID={`record-trip-plan-order-${row.slotKey}`}
            order={row.planOrder}
          />
        ) : null}
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
