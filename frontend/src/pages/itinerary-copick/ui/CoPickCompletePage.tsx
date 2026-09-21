import type { ReactElement } from 'react';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import {
  buildDraftDayTabs,
  buildDraftPins,
  formatDraftDayHeader,
} from '@/features/itinerary/model/draftView';
import { timeBandLabel } from '@/features/itinerary/model/timeBandLabel';
import { WarningTriangleGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { SlotStopCard } from '@/entities/itinerary-slot/ui/SlotStopCard';
import {
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { StateNotice } from '@/shared/ui/StateNotice';
import { DistanceConnector } from '@/widgets/map-sheet-shell/ui/DistanceConnector';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';
import { SheetHeader } from '@/widgets/map-sheet-shell/ui/SheetHeader';

/**
 * TRIP-796 · h11 "같이 결과 · CoPick 완료" 배선 — itinerary GET + 트립 GET 을 받아 **공용 지도+시트
 * 셸**(`MapSheetShell`)로 완성 얼굴을 조립한다(01b D1 · 계약 플립). 옛 `CoPickCompleteScreen`(features)
 * 은 features→widgets 상향 참조 금지라 셸을 못 물어 삭제됐고, 이 조립을 페이지가 진다(h07/h08 `DraftPage`
 * 선례).
 *
 * 무엇을 보장하나:
 *  - **전 슬롯 검증 시각**(BR-U3-07 개정 · INV-2): 비고정 슬롯은 시각 범위(`HH:mm–HH:mm`, en-dash),
 *    고정 숙소는 단일 시각(`HH:mm`)+부제+고정 배지. 옛 "비고정 시각 0" 계약의 정반대다.
 *  - **카운트는 비고정만**: 헤더 meta `{N}/{N} 골랐어요`(N=선택일 비고정 슬롯 수) — 고정(숙소)은
 *    "고른" 대상이 아니라 세지 않는다.
 *  - **읽기 전용**: "다른 후보 ›" 링크는 어느 슬롯에도 안 건다(onPressAlt 미주입, h08 과 차이).
 *  - **INV-4 narrow**: 데이터 도착 얼굴만 셸. error/loading 은 셸이 아니라 기존 얼굴(testID 보존).
 */

export interface CoPickCompletePageProps {
  tripId: string;
}

/** 고정 슬롯(숙소) 부제 — `{도착 시간대} · 숙소 · 변경 불가`(01b D3, 발명 display copy · 헬퍼로 동결). */
function fixedSlotSubtitle(startAt: string): string {
  return `${timeBandLabel(startAt)} · 숙소 · 변경 불가`;
}

export function CoPickCompletePage({
  tripId,
}: CoPickCompletePageProps): ReactElement {
  const router = useRouter();
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  const trip = useGetTripsTripId(tripId);
  const itinerary = useGetTripsTripIdItinerary(tripId);

  // 조회 실패는 침묵하지 않는다(INV-4 · D5) — 셸이 아니라 기존 error 얼굴(testID 보존).
  if (trip.isError || itinerary.isError) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <StateNotice
          testID="itinerary-copick-complete-error"
          icon={<WarningTriangleGlyph />}
          title="일정을 불러올 수 없어요"
          description="잠시 후 다시 시도해 주세요."
          actions={[
            {
              testID: 'itinerary-copick-complete-retry',
              label: '다시 시도',
              variant: 'filled',
              onPress: () => itinerary.refetch(),
            },
          ]}
        />
      </SafeAreaView>
    );
  }

  // 데이터 도착 전에는 셸을 그리지 않는다 — 트립·일정 둘 다 있어야 헤더·시각·거리를 조립할 수 있다.
  if (itinerary.data === undefined || trip.data === undefined) {
    return (
      <View testID="itinerary-copick-complete-loading" style={{ flex: 1 }} />
    );
  }

  const days = itinerary.data.days;
  // 탭·일차·날짜의 출처는 **여행 기간**이다(day-chip 개수는 days.length 가 아님, D2). 데이터가 없는
  // 날짜는 비활성으로 남고, 선택은 데이터가 있는 날로 되돌아간다(DraftPage 선례).
  const tabs = buildDraftDayTabs({
    startDate: trip.data.startDate,
    endDate: trip.data.endDate,
    days,
  });
  const selectedDate =
    pickedDate !== null &&
    tabs.some((tab) => tab.date === pickedDate && tab.hasData)
      ? pickedDate
      : (tabs.find((tab) => tab.hasData)?.date ?? tabs[0]?.date ?? '');

  const dayChips = tabs.map((tab) => ({ label: `${tab.dayNumber}일차` }));
  const selectedDayIndex = tabs.findIndex((tab) => tab.date === selectedDate);
  const selectedDayNumber =
    tabs.find((tab) => tab.date === selectedDate)?.dayNumber ?? 1;

  const slots = days.find((day) => day.date === selectedDate)?.slots ?? [];
  const pins = buildDraftPins(slots);
  const center =
    pins.length > 0
      ? { lat: pins[0].lat, lng: pins[0].lng }
      : { lat: 0, lng: 0 };

  // meta 는 **비고정만** 센다 — 고정(숙소)은 "고른" 대상이 아니다(D2 · coPickProgress 재사용 금지).
  const pickedCount = slots.filter((slot) => !slot.isFixed).length;

  return (
    <MapSheetShell
      center={center}
      pins={pins}
      days={dayChips}
      selectedDayIndex={selectedDayIndex < 0 ? 0 : selectedDayIndex}
      onSelectDay={(index) => setPickedDate(tabs[index]?.date ?? null)}
      onBack={() => router.back()}
      header={
        <SheetHeader
          title={trip.data.title}
          dayLabel={`${selectedDayNumber}일차`}
          dateLabel={formatDraftDayHeader(selectedDate)}
          meta={`${pickedCount}/${pickedCount} 골랐어요`}
        />
      }
      cta={[
        {
          label: '확정하기',
          variant: 'primary',
          onPress: () =>
            router.push({
              pathname: '/trips/[tripId]/itinerary',
              params: { tripId },
            }),
        },
      ]}
    >
      <View className="gap-md px-lg pb-2xl pt-xs">
        {slots.flatMap((slot, index) => {
          // 전 슬롯 검증 시각(BR-U3-07 · D3). 비고정=범위(en-dash U+2013), 고정 숙소=단일 시각.
          const timeLabel = slot.isFixed
            ? slot.startAt.slice(0, 5)
            : `${slot.startAt.slice(0, 5)}–${slot.endAt.slice(0, 5)}`;
          const items: ReactElement[] = [
            <SlotStopCard
              key={`card-${slot.poiId}`}
              slot={slot}
              date={selectedDate}
              index={index}
              timeLabel={timeLabel}
              fixed={slot.isFixed}
              subtitle={
                slot.isFixed ? fixedSlotSubtitle(slot.startAt) : undefined
              }
            />,
          ];
          if (index < slots.length - 1) {
            const nextSlot = slots[index + 1];
            items.push(
              <DistanceConnector
                key={`conn-${slot.poiId}`}
                slotKey={buildSlotKey(selectedDate, slot.poiId)}
                distanceRange={nextSlot.distanceRange}
              />
            );
          }
          return items;
        })}
      </View>
    </MapSheetShell>
  );
}
