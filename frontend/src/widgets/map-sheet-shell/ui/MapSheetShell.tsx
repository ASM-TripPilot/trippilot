import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { View } from 'react-native';
import type { ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet, {
  BottomSheetFlatList,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';

import {
  MapView,
  type MapCenter,
  type MapPin,
  type MapViewProps,
} from '@/shared/map';

import { CtaBar, type CtaButton } from './CtaBar';
import { DayChipOverlay, type DayChip } from './DayChipOverlay';
import { MapFallbackBar } from './MapFallbackBar';

// 위젯 킷 소비처가 시트 body(카드·커넥터)를 조립할 때 쓰는 서버 슬롯 타입을 킷 표면으로 재수출한다
// (widgets → entities 하향 참조 허용, `entities/itinerary-slot/model` 이 shared/api 를 얇게 재수출).
export type { ItineraryDaysItemSlotsItem } from '@/entities/itinerary-slot/model';

/**
 * TRIP-783 · h공통 지도+시트 셸(widgets) — h·i 밴드 지도 결과 화면들이 공유하는 골격. 전면 지도(`<MapView viewOnly>`, 시트 뒤 형제) + 좌상단 일차 칩 오버레이 +
 * 3스냅 바텀시트(닫힘·peek·펼침, `header`·`children`) + 하단 고정 CTA 바를 **조립만** 한다. 시각·합산 같은
 * 판단은 전부 소비처로 밀어냈다(셸은 받은 ReactNode·문자열·콜백만 배치한다). 예외 둘 — 셸이 상태를 쥔다
 * (widgetsStructure F 예외 등재): ① 지도 로드 실패(TRIP-919) — 소비처 배선 없이 폴백을 얻게 하려고.
 * ② 시트가 멈춘 칸(TRIP-920) — 기본 배열의 닫힘(0번)에서만 지도 잠금을 풀고 CTA 바를 뺀다.
 *
 * ⚠️ 원리적 사각(6-b 실기 전용): 스냅 실개폐·딤·`enableContentPanningGesture`(E6) 는 `@gorhom/
 * bottom-sheet` 통과형 목이, 지도 제스처·타일은 네이버 목이 못 본다. 지도는 시트 **뒤 형제**로 두어
 * (시트 콘텐츠 안에 넣지 않아) 제스처 삼킴을 구조로 피한다(E7). jest 는 `map-root`·children·testID
 * 트리만 관측하고, `viewOnly` 실전달은 `itineraryMapSurfaceStructure` S2 소스 스캔이 잠근다.
 */

// 기본 3스냅(닫힘 28 / peek ≈ 45% / expanded ≈ 88%) — 라이브러리 규칙상 낮은 높이부터 오름차순.
// 닫힘 28 = 핸들만 보이는 높이(i01 닫힘 Figma 4251:2448 과 같은 출처, `LiveHubView.CLOSED_SNAP` 과 값 일치).
// 기본 진입은 peek(1) — 실 전환은 6-b 실기 몫.
const SNAP_POINTS = [28, '45%', '88%'];
const DEFAULT_INDEX = 1;

/**
 * 시트 body 리스트 슬롯(TRIP-798 묶음 C 가산) — 주면 셸이 body 를 `<BottomSheetScrollView>` 대신
 * `<BottomSheetFlatList>` 로 그려, 무한 스크롤 리스트(h13 장소 후보, `onEndReached`)를
 * VirtualizedList-in-ScrollView 충돌 없이 담는다(맹점①). `header`·`children` 은 리스트의
 * `ListHeaderComponent` 로 맨 위에 얹힌다. 미전달이면 현행 스크롤 경로(6 소비처 무변경).
 *
 * ⚠️ 타입 선언만 — 실제 `<BottomSheetFlatList>` 렌더 배선은 [구현] 몫(`MapSheetShell.test.tsx`
 *   SH8b 가 red 로 강제). 제네릭 `T` 는 `list.data` 로 추론된다(화면마다 다른 아이템 타입 수용).
 */
export interface MapSheetListSlot<T = unknown> {
  data: readonly T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T, index: number) => string;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  ListFooterComponent?: ReactElement | null;
  /** 빈 목록 안내(TRIP-924) — `data` 가 0건일 때 FlatList 가 그린다. 미전달이면 셸은 아무것도 안
   *  그린다. 언제 줄지(로딩 중 제외 등)는 소비처 판단이다. */
  ListEmptyComponent?: ReactElement | null;
  testID?: string;
}

export interface MapSheetShellProps<T = unknown> {
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
  /** 바텀시트 초기 스냅 인덱스 — 스냅 배열 번호 그대로(기본 배열이면 0=닫힘 / 1=peek / 2=expanded).
   *  미전달이면 기본 배열은 1(peek), `snapPoints` 를 직접 준 소비처는 0. 펼침 진입 소비처(i06·i07·
   *  `h08-draft-expanded`)가 2 를 준다(TRIP-920). 실 스냅 전환은 6-b 실기 몫. */
  initialIndex?: number;
  /** 지도 자리 교체 슬롯(TRIP-799 D5·AC-6). 주면 지도 스트립 자리에 `<MapView>` 대신 이 노드를
   *  렌더한다(day-chip·시트·CTA 는 유지 — 화면을 안 비운다, INV-4). 셸 자체 실패 감지보다 우선한다.
   *  미전달이면 MapView 를 그리고, 그 MapView 가 로드 실패를 알리면 셸 기본 `MapFallbackBar` 로
   *  바꾼다(TRIP-919). */
  mapFallback?: ReactNode;
  /** 지도 위 성공 배너 등 추가 카드(TRIP-801 D3·AC-1). 주면 day-chip 오버레이 **아래에** 추가로
   *  렌더한다(`overlay` 교체와 달리 추가). 미전달=미렌더(후방호환). 타입 선언만 — 렌더 배선은
   *  [구현] 몫(SH7b 가 red 로 강제). h16 확정 성공 배너가 이 슬롯을 쓴다. */
  mapCard?: ReactNode;
  /** 시트 body 리스트 슬롯(TRIP-798 묶음 C 가산) — 주면 body 를 `<BottomSheetFlatList>` 로 그려
   *  header·children 을 `ListHeaderComponent` 로 얹는다. 미전달=현행 `<BottomSheetScrollView>`
   *  (6 소비처 무변경). 타입 선언만 — 렌더 배선은 [구현] 몫(SH8b 가 red 로 강제). h13 이 첫 소비처. */
  list?: MapSheetListSlot<T>;
  /** 바텀시트 스냅 포인트(TRIP-746 가산) — i01 허브가 3스냅(닫힘·중간·펼침)을 준다. 미전달이면
   *  기본 3스냅 `SNAP_POINTS`. 직접 주면 "0번 = 닫힘" 규칙(지도 풀림·CTA 숨김)이 적용되지 않는다. */
  snapPoints?: (string | number)[];
  /** 지도 잠금 여부(TRIP-746 가산) — 미전달이면 기본 잠금, 기본 배열의 닫힘 칸에서만 풀림(TRIP-920). i01 허브만
   *  `false` 로 열어 여행 중 자유 탐색을 유지한다(TRIP-397 결정 계승, `itineraryMapSurfaceStructure`
   *  S2b 가 소비처를 잠근다). */
  mapViewOnly?: boolean;
  /** 현재위치 점(TRIP-746 가산) — `<MapView currentLocation>` 으로 흘린다(TRIP-745 계약). 미전달이면
   *  점 없음. */
  currentLocation?: MapCenter;
  /** 시트 스냅 이동 시작(TRIP-748 가산) — `<BottomSheet onAnimate>` 로 그대로 흘린다. 마운트 가드
   *  같은 판단은 소비처(i01 허브) 몫이다. 미전달=미부착. */
  onSheetAnimate?: (fromIndex: number, toIndex: number) => void;
  /** 시트 본문 스크롤 시작(TRIP-748 가산) — `<BottomSheetScrollView onScrollBeginDrag>` 로 흘린다.
   *  `list` 경로에는 달지 않는다(소비처 없음). 미전달=미부착. */
  onSheetScrollBeginDrag?: () => void;
  /** 지도 빈 곳 탭(TRIP-748 가산) — `<MapView onTapMap>` 으로 흘린다. 미전달=미부착. */
  onMapTap?: () => void;
  /** 반경 원(TRIP-800 가산, h15) — `<MapView radiusCircle>` 로 흘린다. 미전달=원 없음(기존 소비처
   *  무변경). */
  radiusCircle?: MapViewProps['radiusCircle'];
}

export function MapSheetShell<T = unknown>({
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
  initialIndex,
  mapFallback,
  mapCard,
  list,
  snapPoints,
  mapViewOnly,
  currentLocation,
  onSheetAnimate,
  onSheetScrollBeginDrag,
  onMapTap,
  radiusCircle,
}: MapSheetShellProps<T>): ReactElement {
  // 지도 로드 실패(TRIP-919). 폴백 중엔 MapView 가 트리에서 빠지므로, 재시도로 이 값을 풀면 MapView 가
  // 새 인스턴스로 다시 마운트돼 실패 알림(notifiedRef)도 처음부터 다시 돈다 — 별도 key 가 필요 없다.
  const [mapFailed, setMapFailed] = useState(false);
  // 이름 붙인 핸들러 — `<MapView>` 태그 안에 `=>` 를 두면 itineraryMapSurfaceStructure 의 태그
  // 정규식이 첫 `>` 에서 잘려 viewOnly 를 못 본다.
  const handleMapLoadFailed = () => setMapFailed(true);
  const handleMapRetry = () => setMapFailed(false);
  // 진입 칸 — 기본 진입값(peek)은 기본 배열에만. 직접 준 배열(i05)로 새면 그 소비처가 펼침으로 열린다.
  const startIndex = initialIndex ?? (snapPoints ? 0 : DEFAULT_INDEX);
  // 시트가 멈춘 칸(TRIP-920). 초기값 = 진입 칸 — 라이브러리가 마운트 때 onChange 를 부르는지 jest 는 모른다.
  const [snapIndex, setSnapIndex] = useState(startIndex);
  // "0번 = 닫힘" 은 기본 배열에서만 참 — 직접 준 배열(i05 ['40%','88%'])의 0번은 열린 시트다.
  const sheetClosed = snapPoints === undefined && snapIndex === 0;
  // 태그 밖 상수 — `<MapView>` 태그 안 viewOnly 앞에 `>` 가 들어가면 위 태그 정규식이 잘린다.
  const mapLocked = mapViewOnly ?? !sheetClosed;

  return (
    <View testID="map-sheet-shell-root" className="flex-1 bg-canvas">
      {/* 전면 지도 — 시트 뒤 형제(절대 배치, 풀블리드). connectPins 무언급=기본 선.
          지도 자리 우선순위: 소비처 mapFallback > 셸 기본 폴백 바(로드 실패 시) > MapView. 어느 쪽이든
          day-chip·시트·CTA 는 유지된다(화면을 안 비운다, INV-4 · TRIP-799 D5 · TRIP-919). */}
      <View className="absolute inset-0">
        {mapFallback ??
          (mapFailed ? (
            <MapFallbackBar onRetry={handleMapRetry} />
          ) : (
            <MapView
              center={center}
              pins={pins}
              viewOnly={mapLocked}
              currentLocation={currentLocation}
              onTapMap={onMapTap}
              radiusCircle={radiusCircle}
              onLoadFailed={handleMapLoadFailed}
            />
          ))}
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
        {/* 성공 배너 등 추가 카드 — day-chip 오버레이 **아래에** 추가로 그린다(교체 아닌 추가 · D3).
            미전달이면 아무것도 안 그린다(후방호환). h16 확정 성공 배너가 이 슬롯을 쓴다. */}
        {mapCard}
      </SafeAreaView>

      {/* 하단 3스냅 시트 — header + children(카드·커넥터). 다중 슬롯이 하단 CTA 뒤로 가려 도달
          불가한 것을 막으려 스크롤 컨테이너로 감싼다(경고-1 해소, 첫 소비자인 h07 에서 처리).
          list 를 주면 body 를 BottomSheetFlatList 로 그려 무한 스크롤 리스트(h13 장소 후보,
          onEndReached)를 VirtualizedList-in-ScrollView 충돌 없이 담는다 — header·children 은 리스트의
          ListHeaderComponent 한 자리에 얹힌다(TRIP-798 묶음 C). 미전달이면 현행 스크롤 경로(6 소비처 무변경). */}
      <BottomSheet
        index={startIndex}
        snapPoints={snapPoints ?? SNAP_POINTS}
        // v5 기본 true 는 콘텐츠 높이 칸을 배열에 몰래 끼워 index·onChange 번호가 어긋난다(03b 경고-1).
        enableDynamicSizing={false}
        // 라이브러리 기본값과 같지만 명시한다 — 시트 안 입력(h13 검색)의 키보드 회피 계약(TRIP-990 D9).
        keyboardBehavior="interactive"
        onChange={setSnapIndex}
        onAnimate={onSheetAnimate}
      >
        {list ? (
          <BottomSheetFlatList
            data={list.data}
            renderItem={list.renderItem}
            keyExtractor={list.keyExtractor}
            ListHeaderComponent={
              <>
                {header}
                {children}
              </>
            }
            ListFooterComponent={list.ListFooterComponent}
            ListEmptyComponent={list.ListEmptyComponent}
            onEndReached={list.onEndReached}
            onEndReachedThreshold={list.onEndReachedThreshold}
            // 헤더 검색 입력의 키보드가 떠 있어도 첫 탭이 행으로 간다 — 기본값(never)은 첫 탭을 키보드
            // 내리기로 먹는다(TRIP-981 #057). 키보드는 안 내려 주므로 내림은 소비처가 한다.
            keyboardShouldPersistTaps="handled"
            testID={list.testID}
          />
        ) : (
          <BottomSheetScrollView onScrollBeginDrag={onSheetScrollBeginDrag}>
            {header}
            {children}
          </BottomSheetScrollView>
        )}
      </BottomSheet>

      {/* 하단 고정 CTA 바 — CTA 가 있을 때만(빈 배열/미전달이면 통째로 미렌더 · D9). 닫힘 칸에선 안 그린다 —
          28px 핸들을 CTA 바가 덮어 시트를 되올릴 손잡이가 사라진다(TRIP-920). */}
      {!sheetClosed && cta !== undefined && cta.length > 0 ? (
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
