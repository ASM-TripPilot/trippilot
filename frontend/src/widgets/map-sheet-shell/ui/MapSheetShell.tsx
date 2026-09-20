import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';

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
  /** 일차 칩 목록 — `overlay` 를 주면 안 쓰인다(옵셔널, D3). */
  days?: DayChip[];
  selectedDayIndex?: number;
  onSelectDay?: (index: number) => void;
  onBack?: () => void;
  /** 좌상단 오버레이 교체 슬롯 — 주면 내부 `DayChipOverlay` 대신 이 노드를 그린다(D3). h07 은
   *  진행 카드(`GenerationProgressCard`)를 day-chip 자리에 얹으므로 이 슬롯을 쓴다. */
  overlay?: ReactNode;
  header: ReactNode;
  children: ReactNode;
  /** 하단 고정 CTA — 미전달/빈 배열이면 CTA 바를 통째로 안 그린다(옵셔널, D3·D9). h07 은 생성
   *  중이라 확정할 완성본이 없어 CTA 자체가 없다. */
  cta?: CtaButton[];
}

export function MapSheetShell({
  center,
  pins,
  days,
  selectedDayIndex,
  onSelectDay,
  onBack,
  overlay,
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

      {/* 좌상단 오버레이 — `overlay` 를 주면 그것을, 아니면 기본 일차 칩 오버레이를 그린다(D3). */}
      <SafeAreaView
        edges={['top']}
        pointerEvents="box-none"
        className="absolute left-0 right-0 top-0 px-lg pt-sm"
      >
        {overlay ?? (
          <DayChipOverlay
            days={days ?? []}
            selectedIndex={selectedDayIndex ?? 0}
            onSelectDay={onSelectDay ?? (() => {})}
            onBack={onBack ?? (() => {})}
          />
        )}
      </SafeAreaView>

      {/* 하단 2스냅 시트 — header + children(카드·커넥터). 다중 슬롯이 하단 CTA 뒤로 가려 도달
          불가한 것을 막으려 스크롤 컨테이너로 감싼다(경고-1 해소, 첫 소비자인 h07 에서 처리). */}
      <BottomSheet index={0} snapPoints={SNAP_POINTS}>
        <BottomSheetScrollView>
          {header}
          {children}
        </BottomSheetScrollView>
      </BottomSheet>

      {/* 하단 고정 CTA 바 — CTA 가 있을 때만(빈 배열/미전달이면 통째로 미렌더 · D9). */}
      {cta !== undefined && cta.length > 0 ? (
        <SafeAreaView
          edges={['bottom']}
          className="absolute bottom-0 left-0 right-0 bg-canvas"
        >
          <CtaBar buttons={cta} />
        </SafeAreaView>
      ) : null}
    </View>
  );
}
