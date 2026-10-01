import { Fragment, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PastTripList } from './PastTripList';
import {
  CalendarGlyph,
  ChevronDownGlyph,
  LegendChevronGlyph,
} from './RecordGlyphs';
import { TripCalendarMonth } from './TripCalendarMonth';
import type {
  LegendRow,
  MonthLegends,
  OngoingTripCardVM,
  PastTripCardVM,
} from '../model/recordsCalendar';
import type { MonthCell } from '@/shared/date/monthGrid';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-575 · j07 여행 캘린더 허브(무상태 프레젠테이션 — 계산된 값·콜백만 받는다).
 * 판정·조회·라우팅을 모른다(목 없이 props 만 넣어 렌더 트리를 관찰). 조립·조회는 `pages/records-calendar`.
 *
 * - AC-1: placeholder 가 아니라 캘린더 허브(record-calendar-month)를 그린다.
 * - AC-5: 저장 여행 0건이면 빈 캘린더 대신 안내 + '새 여행' 버튼(record-calendar-empty[-create]).
 * - 지난 여행이 0건이어도(총 여행>0) 캘린더는 뜬다.
 *
 * 경계(G2·프리뷰 격리): `@/shared/api`·`@/features/*`(stay/trip/itinerary/reflection/execution)를 import
 * 하지 않는다 — 빈 상태 아이콘은 record 자체 글리프(`CalendarGlyph`)를 쓴다.
 *
 * legend(TRIP-1084)는 페이지가 `buildMonthLegends`로 만든 `monthLegends`(옵셔널)를 받아 앞 줄만 그리고,
 * '더 보기 N'·묶음 줄 누름으로 같은 자리에서 펼친다. 펼침 두 가지는 화면 로컬 UI 상태이고 월이 바뀌면
 * 처음으로 돌아간다(`key={monthLabel}`).
 *
 * TRIP-1120 · 앱바 아래·캘린더 위 진행 중 여행 카드(`ongoingTrip`, Figma 4761:3065)와 legend 줄 끝 `›`
 * (`openableTripIds` 에 든 줄만 — 미래 줄엔 없다, INV-4). 둘 다 판정은 페이지 몫이고 여기선 그리기만 한다.
 * legend 줄은 32 높이로 붙어 있어 세로 hitSlop 을 주지 않는다(이웃 줄을 덮는다).
 */

export interface RecordsCalendarScreenProps {
  monthLabel: string;
  grid: (MonthCell | null)[];
  markedDays: string[];
  pastTrips: PastTripCardVM[];
  isEmpty: boolean;
  /** 현재 달에 걸친 여행 legend(미지정·줄 0개면 미표시). */
  monthLegends?: MonthLegends;
  onPressPrevMonth: () => void;
  onPressNextMonth: () => void;
  onSelectTrip: (tripId: string) => void;
  onPressCreateTrip: () => void;
  /** 마킹 날짜 탭(TRIP-1015 C) — 목적지 판정은 페이지 몫. */
  onPressDay?: (date: string) => void;
  /** 범례 행 탭(TRIP-1015 C) — 미래 여행 무시 판정은 페이지 몫. */
  onPressLegend?: (tripId: string) => void;
  /** 진행 중 여행 카드(미지정·null 이면 미표시). */
  ongoingTrip?: OngoingTripCardVM | null;
  onPressOngoingRecords?: (tripId: string) => void;
  onPressOngoingHub?: (tripId: string) => void;
  /** 누르면 이동하는 여행 — 이 집합에 든 legend 줄에만 `›`(미지정이면 어디에도 없음). */
  openableTripIds?: ReadonlySet<string>;
}

// Figma 카드 그림자 0 2 10 rgba(0,0,0,.06) — className 으로 못 줘 style prop(StayRecommendCard 선례).
const CARD_SHADOW = {
  shadowColor: 'black',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

function CalendarAppBar(): ReactElement {
  return (
    <View className="w-full flex-row items-center bg-canvas px-lg pb-[12px] pt-[4px]">
      <Text className="font-noto-bold text-section font-bold text-ink">
        여행 캘린더
      </Text>
    </View>
  );
}

/** 진행 중 여행 카드(Figma 4761:3065) — 제목 + `여행 중` 배지, `기간 · N일차`, 두 버튼(44). */
function OngoingTripCard({
  trip,
  onPressRecords,
  onPressHub,
}: {
  trip: OngoingTripCardVM;
  onPressRecords?: (tripId: string) => void;
  onPressHub?: (tripId: string) => void;
}): ReactElement {
  return (
    <View className="w-full px-lg pb-sm pt-xs">
      <View
        testID="record-calendar-ongoing"
        className="w-full gap-md rounded-[12px] border border-hairline bg-canvas p-md"
        style={CARD_SHADOW}
      >
        <View className="w-full gap-xs">
          <View className="flex-row items-center gap-[6px]">
            <Text
              numberOfLines={1}
              className="shrink font-noto-bold text-card-title font-bold text-ink"
            >
              {trip.title}
            </Text>
            <View className="rounded-button bg-primary-pale px-sm py-[3px]">
              <Text className="font-noto-bold text-micro font-bold text-primary">
                여행 중
              </Text>
            </View>
          </View>
          <Text className="font-noto text-label text-muted">
            {trip.dateRangeLabel !== null && `${trip.dateRangeLabel} · `}
            <Text className="font-noto-bold font-bold text-ink">
              {trip.dayLabel}
            </Text>
          </Text>
        </View>
        <View className="w-full flex-row gap-sm">
          <Pressable
            testID="record-calendar-ongoing-records"
            accessibilityRole="button"
            className="h-[44px] flex-1 items-center justify-center rounded-button bg-primary"
            onPress={onPressRecords && (() => onPressRecords(trip.tripId))}
          >
            <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
              오늘 기록 보기
            </Text>
          </Pressable>
          <Pressable
            testID="record-calendar-ongoing-hub"
            accessibilityRole="button"
            className="h-[44px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
            onPress={onPressHub && (() => onPressHub(trip.tripId))}
          >
            <Text className="font-noto-bold text-[16px] font-bold text-ink">
              일정 허브로
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * 한 줄 legend(Figma legend-row: 줄마다 pt10·pb6 → 32 높이). 텍스트 조각은 호출부가 넘긴다.
 * `chevronTestID` 가 있으면 줄 끝에 `›`(14, Figma 4761:3104) — 누름 영역과 같은 Pressable 안.
 */
function LegendLine({
  testID,
  chevronTestID,
  onPress,
  children,
}: {
  testID: string;
  chevronTestID?: string;
  onPress?: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      className="w-full flex-row items-center gap-sm px-lg pb-[6px] pt-[10px]"
      onPress={onPress}
    >
      <View className="h-[9px] w-[9px] rounded-pill bg-primary" />
      <Text className="flex-1 font-noto text-label text-body">{children}</Text>
      {chevronTestID !== undefined && (
        <View testID={chevronTestID}>
          <LegendChevronGlyph />
        </View>
      )}
    </Pressable>
  );
}

function joinLabel(parts: (string | null)[]): string {
  return parts.filter((part) => part !== null && part !== '').join(' · ');
}

function TripLegendLine({
  trip,
  openable,
  onPressLegend,
}: {
  trip: PastTripCardVM;
  openable?: ReadonlySet<string>;
  onPressLegend?: (tripId: string) => void;
}): ReactElement {
  return (
    <LegendLine
      testID={`record-calendar-legend-${trip.tripId}`}
      chevronTestID={
        openable?.has(trip.tripId)
          ? `record-calendar-legend-chevron-${trip.tripId}`
          : undefined
      }
      onPress={onPressLegend && (() => onPressLegend(trip.tripId))}
    >
      {joinLabel([trip.title, trip.dateRangeLabel, trip.nightsLabel])}
    </LegendLine>
  );
}

/**
 * legend 블록 — 앞 줄 + '더 보기 N'/'접기', 묶음 줄 누름은 바로 아래 구성원 펼침(이동 콜백 안 부름).
 * 3줄 제한은 최상위 줄 기준이라 묶음을 펼쳐도 다른 줄이 밀려 숨지 않는다. 두 펼침은 서로 독립이다.
 */
function MonthLegendBlock({
  legends,
  openable,
  onPressLegend,
}: {
  legends: MonthLegends;
  openable?: ReadonlySet<string>;
  onPressLegend?: (tripId: string) => void;
}): ReactElement {
  const [showAll, setShowAll] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const { rows, hiddenCount } = legends;
  const shown = showAll ? rows : rows.slice(0, rows.length - hiddenCount);

  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const renderRow = (row: LegendRow): ReactElement => {
    if (row.kind === 'trip') {
      return (
        <TripLegendLine
          key={row.tripId}
          trip={row}
          openable={openable}
          onPressLegend={onPressLegend}
        />
      );
    }
    const rest = joinLabel([row.dateRangeLabel, row.nightsLabel]);
    return (
      <Fragment key={row.key}>
        <LegendLine
          testID={`record-calendar-legend-group-${row.key}`}
          // 묶음 줄 `›` = 구성원 중 하나라도 열림(누르면 펼침이라 동작은 늘 있다).
          chevronTestID={
            row.members.some((member) => openable?.has(member.tripId))
              ? `record-calendar-legend-group-chevron-${row.key}`
              : undefined
          }
          onPress={() => toggleGroup(row.key)}
        >
          {row.representativeTitle}{' '}
          <Text testID={`record-calendar-legend-group-count-${row.key}`}>
            외 {row.members.length - 1}
          </Text>
          {rest !== '' && ` · ${rest}`}
        </LegendLine>
        {openGroups.has(row.key) &&
          row.members.map((member) => (
            <TripLegendLine
              key={member.tripId}
              trip={member}
              openable={openable}
              onPressLegend={onPressLegend}
            />
          ))}
      </Fragment>
    );
  };

  return (
    <View className="w-full">
      {shown.map(renderRow)}
      {hiddenCount > 0 && (
        <Pressable
          testID="record-calendar-legend-more"
          className="w-full flex-row items-center gap-xs pb-[6px] pl-[33px] pr-lg pt-[10px]"
          onPress={() => setShowAll((open) => !open)}
        >
          <Text className="font-noto text-label text-muted">
            {showAll ? '접기' : `더 보기 ${hiddenCount}`}
          </Text>
          <View
            testID="record-calendar-legend-more-chevron"
            style={showAll ? { transform: [{ rotate: '180deg' }] } : undefined}
          >
            <ChevronDownGlyph />
          </View>
        </Pressable>
      )}
    </View>
  );
}

export function RecordsCalendarScreen({
  monthLabel,
  grid,
  markedDays,
  pastTrips,
  isEmpty,
  monthLegends,
  onPressPrevMonth,
  onPressNextMonth,
  onSelectTrip,
  onPressCreateTrip,
  onPressDay,
  onPressLegend,
  ongoingTrip,
  onPressOngoingRecords,
  onPressOngoingHub,
  openableTripIds,
}: RecordsCalendarScreenProps): ReactElement {
  if (isEmpty) {
    return (
      <SafeAreaView
        edges={['top', 'bottom']}
        style={{ flex: 1 }}
        className="bg-canvas"
      >
        <CalendarAppBar />
        <View className="flex-1 items-center justify-center px-lg">
          <StateNotice
            testID="record-calendar-empty"
            icon={<CalendarGlyph size={32} />}
            title="아직 기록된 여행이 없습니다"
            description="여행을 만들고 다녀오면 이곳에서 사진과 메모로 돌아볼 수 있어요"
            actions={[
              {
                testID: 'record-calendar-empty-create',
                label: '새 여행 만들기',
                variant: 'filled',
                onPress: onPressCreateTrip,
              },
            ]}
            dashed
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }} className="bg-canvas">
      <CalendarAppBar />
      <ScrollView className="flex-1" contentContainerClassName="pb-[100px]">
        {ongoingTrip && (
          <OngoingTripCard
            trip={ongoingTrip}
            onPressRecords={onPressOngoingRecords}
            onPressHub={onPressOngoingHub}
          />
        )}

        <View className="w-full px-lg py-[4px]">
          <TripCalendarMonth
            monthLabel={monthLabel}
            grid={grid}
            markedDays={markedDays}
            onPressPrev={onPressPrevMonth}
            onPressNext={onPressNextMonth}
            onPressDay={onPressDay}
          />
        </View>

        {/* legend — 이 달에 걸친 여행. 코랄 점 + 제목·기간·박수. */}
        {monthLegends && monthLegends.rows.length > 0 && (
          <MonthLegendBlock
            key={monthLabel}
            legends={monthLegends}
            openable={openableTripIds}
            onPressLegend={onPressLegend}
          />
        )}

        {/* 지난 여행 섹션 헤더 */}
        <View className="w-full flex-row items-center justify-between px-lg pb-[8px] pt-[16px]">
          <Text className="font-noto-bold text-[16px] font-bold text-ink">
            지난 여행
          </Text>
          <Text className="font-noto text-label text-muted">
            {pastTrips.length}개
          </Text>
        </View>

        <View className="w-full px-lg">
          <PastTripList pastTrips={pastTrips} onSelectTrip={onSelectTrip} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
