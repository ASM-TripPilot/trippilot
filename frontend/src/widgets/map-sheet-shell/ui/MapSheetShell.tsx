import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import { MapView, type MapCenter, type MapPin } from '@/shared/map';

import { CtaBar, type CtaButton } from './CtaBar';
import { DayChipOverlay, type DayChip } from './DayChipOverlay';

// 위젯 킷 소비처가 시트 body(카드·커넥터)를 조립할 때 쓰는 서버 슬롯 타입을 킷 표면으로 재수출한다
// (widgets → entities 하향 참조 허용, `entities/itinerary-slot/model` 이 shared/api 를 얇게 재수출).
export type { ItineraryDaysItemSlotsItem } from '@/entities/itinerary-slot/model';

/**
 * TRIP-783 · h공통 지도+시트 셸(widgets · presentation-only, useState 0) — h07·h08·h11·h14·h16 결과
 * 6종이 공유하는 골격. 전면 지도(`<MapView viewOnly>`, 시트 뒤 형제) + 좌상단 일차 칩 오버레이 +
 * 2스냅 바텀시트(`header`·`children`) + 하단 고정 CTA 바를 **조립만** 한다. 시각·합산·시트 개폐 같은
 * 판단은 전부 소비처로 밀어냈다(셸은 받은 ReactNode·문자열·콜백만 배치한다).
 *
 * ⚠️ 원리적 사각(6-b 실기 전용): 2스냅 실개폐·딤·`enableContentPanningGesture`(E6) 는 `@gorhom/
 * bottom-sheet` 통과형 목이, 지도 제스처·타일은 네이버 목이 못 본다. 지도는 시트 **뒤 형제**로 두어
 * (시트 콘텐츠 안에 넣지 않아) 제스처 삼킴을 구조로 피한다(E7). jest 는 `map-root`·children·testID
 * 트리만 관측하고, `viewOnly` 실전달은 `itineraryMapSurfaceStructure` S2 소스 스캔이 잠근다.
 */

// 2스냅(peek ≈ 45% / expanded ≈ 88%). 초기값은 index=0(peek) 고정 — 실 전환은 6-b 실기 몫.
const SNAP_POINTS = ['45%', '88%'];

export interface MapSheetShellProps {
  center: MapCenter;
  pins?: MapPin[];
  days: DayChip[];
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
  onBack: () => void;
  header: ReactNode;
  children: ReactNode;
  cta: CtaButton[];
}

export function MapSheetShell({
  center,
  pins,
  days,
  selectedDayIndex,
  onSelectDay,
  onBack,
  header,
  children,
  cta,
}: MapSheetShellProps): ReactElement {
  return (
    <View testID="map-sheet-shell-root" className="flex-1 bg-canvas">
      {/* 전면 지도 — 시트 뒤 형제(절대 배치, 풀블리드). connectPins 무언급=기본 선. */}
      <View className="absolute inset-0">
        <MapView center={center} pins={pins} viewOnly />
      </View>

      {/* 좌상단 오버레이 — back + 일차 칩(상태바 아래로 SafeArea top inset). */}
      <SafeAreaView
        edges={['top']}
        pointerEvents="box-none"
        className="absolute left-0 right-0 top-0 px-lg pt-sm"
      >
        <DayChipOverlay
          days={days}
          selectedIndex={selectedDayIndex}
          onSelectDay={onSelectDay}
          onBack={onBack}
        />
      </SafeAreaView>

      {/* 하단 2스냅 시트 — header + children(카드·커넥터). */}
      <BottomSheet index={0} snapPoints={SNAP_POINTS}>
        <BottomSheetView className="flex-1">
          {header}
          {children}
        </BottomSheetView>
      </BottomSheet>

      {/* 하단 고정 CTA 바(홈 인디케이터 아래로 SafeArea bottom inset). */}
      <SafeAreaView
        edges={['bottom']}
        className="absolute bottom-0 left-0 right-0 bg-canvas"
      >
        <CtaBar buttons={cta} />
      </SafeAreaView>
    </View>
  );
}
