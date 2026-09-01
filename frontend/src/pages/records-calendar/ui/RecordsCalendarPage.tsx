import { useState, type ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  buildPastTripCards,
  formatTripDateRange,
  markedDaysOfMonth,
  nightsLabel,
  type PastTripCardVM,
} from '@/features/record/model/recordsCalendar';
import { useRecordsCalendar } from '@/features/record/model/useRecordsCalendar';
import { RecordsCalendarScreen } from '@/features/record/ui/RecordsCalendarScreen';
import { buildMonthGrid, shiftMonth } from '@/shared/date/monthGrid';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-575 · records-calendar 페이지 — j07 기록 탭 허브의 조회·조립·배선 단일 출처(FSD).
 *
 * `useRecordsCalendar()`(=`GET /trips` 얇은 래퍼)로 여행 목록을 받아, 이번 달(시계에서 문자열로 1회
 * 읽음)을 로컬 state 로 두고 `buildMonthGrid`·`markedDaysOfMonth`·`buildPastTripCards`(순수)로 화면 props
 * 를 조립한다. 월 이동은 `shiftMonth` 순수 계산으로 state 만 갈아 끼운다(재조회 0 — 캘린더는 전체 여행을
 * 클라에서 마킹). 여행 선택→`/trips/{id}/records/compare`(j02, Q1), 빈 상태→`/trips/new/step1`.
 *
 * `useRouter()` 를 쓴다(imperative `router` 아님, ★D9) — tabsShell(expoRouterTabsMock)·route 목이
 * `useRouter` 를 제공해 이 페이지가 크래시 없이 렌더된다.
 *
 * ⚠️ 페이지 조립(월 라벨 서식·legend 파생·콜백 배선)은 jest 무심판이다 — 6-b 실기가 유일한 그물
 * (`RecordsComparePage`·`TripRecordsPage` 동형 사각).
 */
export function RecordsCalendarPage(): ReactElement {
  const { trips, isPending, isError } = useRecordsCalendar();
  const router = useRouter();

  const today = new Date().toISOString().slice(0, 10);
  const [yearMonth, setYearMonth] = useState(today.slice(0, 7));

  // INV-4 · trips=[] 는 로딩·에러에서도 나온다 — isError·isPending 을 빈 상태보다 먼저 갈라
  // "여행 없음 + 새 여행" 얼굴이 그 위로 새지 않게 막는다(셸 교체 전 placeholder 가 막던 침묵 실패).
  if (isError) {
    return (
      <StateNotice
        testID="record-calendar-error"
        illustration={
          <View className="h-[72px] w-[72px] rounded-full bg-surface-soft" />
        }
        title="기록을 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요"
        actions={[]}
      />
    );
  }

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator />
      </View>
    );
  }

  const [year, month] = yearMonth.split('-').map(Number);
  const monthLabel = `${year}년 ${month}월`;

  const grid = buildMonthGrid(yearMonth);
  const markedDays = markedDaysOfMonth(trips, yearMonth);
  const pastTrips = buildPastTripCards(trips, today);

  // legend — 이 달에 걸친 여행만(과거·미래 무관). 화면 props 에 여행 라벨이 없어 페이지가 완성해 넘긴다.
  const monthLegends: PastTripCardVM[] = trips
    .filter((trip) => markedDaysOfMonth([trip], yearMonth).length > 0)
    .map((trip) => ({
      tripId: trip.tripId,
      title: trip.title,
      dateRangeLabel: formatTripDateRange(
        trip.startDate ?? null,
        trip.endDate ?? null
      ),
      nightsLabel: nightsLabel(trip.startDate ?? null, trip.endDate ?? null),
    }));

  return (
    <RecordsCalendarScreen
      monthLabel={monthLabel}
      grid={grid}
      markedDays={markedDays}
      pastTrips={pastTrips}
      monthLegends={monthLegends}
      isEmpty={trips.length === 0}
      onPressPrevMonth={() => setYearMonth((ym) => shiftMonth(ym, -1))}
      onPressNextMonth={() => setYearMonth((ym) => shiftMonth(ym, 1))}
      onSelectTrip={(tripId) => router.push(`/trips/${tripId}/records/compare`)}
      onPressCreateTrip={() => router.push('/trips/new/step1')}
    />
  );
}
