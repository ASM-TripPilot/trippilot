import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatDayLabel } from '@/entities/trip/lib/formatDayLabel';
import { formatCoPickDayHeader } from '@/features/itinerary/model/draftView';
import {
  GpsOffGlyph,
  InfoCircleGlyph,
  VisitCheckUpcomingGlyph,
} from '@/features/record/ui/RecordGlyphs';
import { SpontaneousVisitButton } from '@/features/record/ui/SpontaneousVisitButton';
import {
  VisitRecordCard,
  type VisitRecordCardVM,
} from '@/features/record/ui/VisitRecordCard';
import type { MapCenter, MapPin } from '@/shared/map';
import { StateNotice } from '@/shared/ui/StateNotice';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';

/**
 * TRIP-1085 · j01 방문 기록 **순수 뷰**(pages · 셸 조립) — 전면 지도 + 바텀시트(Figma 4705:2756).
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
}

type SheetItem =
  | { kind: 'card'; card: VisitRecordCardVM }
  | { kind: 'plan'; row: RecordPlanRowVM };

const DEFAULT_NOTICE = '오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요';

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
}: TripRecordsViewProps): ReactElement {
  const activeIndex = dayTabs.findIndex((tab) => tab.day === activeDay);

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
        days={dayTabs.map((tab) => ({ label: tab.label }))}
        selectedDayIndex={activeIndex}
        onSelectDay={(index) => {
          const tab = dayTabs[index];
          if (tab) onSelectDay(tab.day);
        }}
        onBack={onPressBack}
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
