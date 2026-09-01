import type { ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PastTripList } from './PastTripList';
import { CalendarGlyph } from './RecordGlyphs';
import { TripCalendarMonth } from './TripCalendarMonth';
import type { PastTripCardVM } from '../model/recordsCalendar';
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
 * legend 행("부산 여행 · 6.10–6.12 · 2박 3일")은 계약에 마킹 날짜만 있고 여행 라벨이 없어, 페이지가
 * `monthLegends`(옵셔널)로 완성해 넘길 때만 그린다(순수 시각 보강, jest 미검증 — props-only 화면 계약 밖).
 */

export interface RecordsCalendarScreenProps {
  monthLabel: string;
  grid: (MonthCell | null)[];
  markedDays: string[];
  pastTrips: PastTripCardVM[];
  isEmpty: boolean;
  /** 현재 달에 걸친 여행 legend(미지정·빈 배열이면 미표시). */
  monthLegends?: PastTripCardVM[];
  onPressPrevMonth: () => void;
  onPressNextMonth: () => void;
  onSelectTrip: (tripId: string) => void;
  onPressCreateTrip: () => void;
}

function CalendarAppBar(): ReactElement {
  return (
    <View className="w-full flex-row items-center bg-canvas px-lg pb-[12px] pt-[4px]">
      <Text className="font-noto-bold text-section font-bold text-ink">
        여행 캘린더
      </Text>
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
        <View className="w-full px-lg py-[4px]">
          <TripCalendarMonth
            monthLabel={monthLabel}
            grid={grid}
            markedDays={markedDays}
            onPressPrev={onPressPrevMonth}
            onPressNext={onPressNextMonth}
          />
        </View>

        {/* legend — 이 달에 걸친 여행. 코랄 점 + 제목·기간·박수. */}
        {monthLegends && monthLegends.length > 0 && (
          <View className="w-full gap-[6px] px-lg pb-[6px] pt-[10px]">
            {monthLegends.map((legend) => (
              <View
                key={legend.tripId}
                className="w-full flex-row items-center gap-sm"
              >
                <View className="h-[9px] w-[9px] rounded-pill bg-primary" />
                <Text className="font-noto text-label text-body">
                  {[legend.title, legend.dateRangeLabel, legend.nightsLabel]
                    .filter((part) => part !== null && part !== '')
                    .join(' · ')}
                </Text>
              </View>
            ))}
          </View>
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
