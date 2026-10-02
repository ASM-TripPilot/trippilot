import { useState, type ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';

import { getGetTripsTripIdItineraryQueryOptions } from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import {
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary';
import {
  buildMonthLegends,
  buildPastTripCards,
  markedDaysOfMonth,
  openableTripIds,
  pickOngoingTrip,
  recordsTripIdForDate,
} from '../model/recordsCalendar';
import { useRecordsCalendar } from '../model/useRecordsCalendar';
import { RecordsCalendarScreen } from './RecordsCalendarScreen';
import { useTripWizardStore } from '@/features/create-trip';
import { buildMonthGrid, shiftMonth } from '@/shared/date';
import { seoulDate } from '@/shared/date';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-575 · records-calendar 페이지 — j07 기록 탭 허브의 조회·조립·배선 단일 출처(FSD).
 *
 * `useRecordsCalendar()`(=`GET /trips` 얇은 래퍼)로 여행 목록을 받아, 이번 달(시계에서 문자열로 1회
 * 읽음)을 로컬 state 로 두고 `buildMonthGrid`·`markedDaysOfMonth`·`buildPastTripCards`(순수)로 화면 props
 * 를 조립한다. 월 이동은 `shiftMonth` 순수 계산으로 state 만 갈아 끼운다(재조회 0 — 캘린더는 전체 여행을
 * 클라에서 마킹). 여행 선택→`/trips/{id}/records/summary`(j04 요약 — j02 비교는 TRIP-769 로 삭제, 목적지
 * `/records`→`/records/summary` 재지정은 TRIP-767), 빈 상태→`/trips/new/step1`.
 *
 * `useRouter()` 를 쓴다(imperative `router` 아님, ★D9) — tabsShell(expoRouterTabsMock)·route 목이
 * `useRouter` 를 제공해 이 페이지가 크래시 없이 렌더된다.
 *
 * legend 파생은 순수 함수 `buildMonthLegends`(TRIP-1084)가 맡고, 페이지 배선은 `tabsRecordsRoute` 가 잠근다.
 *
 * TRIP-1120 · 진행 중 카드 — 여행마다 일정을 조회해(h06 과 같은 캐시 키) 확정·없음(404)·모름으로 접고
 * `pickOngoingTrip` 이 한 장을 고른다. 404 아닌 실패는 옛 data 가 남아 있어도 모름이다(남은 값을 믿지
 * 않는다). legend `›` 와 legend 누름은 같은 `openableTripIds` 집합을 본다.
 */
export function RecordsCalendarPage(): ReactElement {
  const { trips, isPending, isError } = useRecordsCalendar();
  const router = useRouter();
  // 훅 호출 순서 규칙 — 아래 일찍 return 들보다 위.
  const itineraries = useQueries({
    queries: trips.map((trip) =>
      getGetTripsTripIdItineraryQueryOptions(trip.tripId)
    ),
  });

  const today = seoulDate(new Date());
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

  const monthLegends = buildMonthLegends(trips, yearMonth);
  const openable = openableTripIds(trips, today);

  const ongoingTrip = pickOngoingTrip(
    trips.map((trip, i) => {
      const query = itineraries[i];
      if (query.isError) {
        return {
          trip,
          itinerary: isNotFound(query.error) ? undefined : 'unknown',
        };
      }
      if (query.isPending) return { trip, itinerary: 'unknown' };
      return { trip, itinerary: query.data.status };
    }),
    today
  );

  return (
    <RecordsCalendarScreen
      monthLabel={monthLabel}
      grid={grid}
      markedDays={markedDays}
      pastTrips={pastTrips}
      monthLegends={monthLegends}
      ongoingTrip={ongoingTrip}
      openableTripIds={openable}
      isEmpty={trips.length === 0}
      onPressPrevMonth={() => setYearMonth((ym) => shiftMonth(ym, -1))}
      onPressNextMonth={() => setYearMonth((ym) => shiftMonth(ym, 1))}
      onSelectTrip={(tripId) => router.push(`/trips/${tripId}/records/summary`)}
      // 마킹 날짜·범례 → 그 여행의 방문 기록. 미래 여행·마킹 없는 날은 무시(TRIP-1015 C · 결정 2).
      onPressDay={(date) => {
        const tripId = recordsTripIdForDate(trips, date, today);
        if (tripId !== null) router.push(`/trips/${tripId}/records`);
      }}
      onPressLegend={(tripId) => {
        if (openable.has(tripId)) router.push(`/trips/${tripId}/records`);
      }}
      onPressOngoingRecords={(tripId) =>
        router.push(`/trips/${tripId}/records`)
      }
      onPressOngoingHub={(tripId) => {
        const data =
          itineraries[trips.findIndex((t) => t.tripId === tripId)]?.data;
        router.push(
          itineraryDestinationHref(
            tripId,
            resolveItineraryDestination({
              notFound: false,
              status: data?.status,
              generationState: data?.generationState,
              generationMode: data?.generationMode,
            }),
            data?.days
          )
        );
      }}
      onPressCreateTrip={() => {
        // 새 여행 진입 — 직전 드래프트를 이동 전에 비운다(TRIP-1012 #074).
        useTripWizardStore.getState().reset();
        router.push('/trips/new/step1');
      }}
    />
  );
}
