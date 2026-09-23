import { Fragment, type ReactElement, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapView, type MapCenter, type MapPin } from '@/shared/map';
import { BottomTabBar, type ShellTabKey } from '@/shared/ui/BottomTabBar';

import { SpontaneousVisitButton } from './SpontaneousVisitButton';
import { BackArrowGlyph, GpsOffGlyph, InfoCircleGlyph } from './RecordGlyphs';
import { VisitRecordCard, type VisitRecordCardVM } from './VisitRecordCard';

/**
 * TRIP-565 · j01 방문 기록 화면(순수 프레젠테이션 — VM·콜백 주입, 조회/판정 0).
 *
 * 세로 컬럼: appbar → 일자 탭 → 지도 히어로(250px) → 부제 → 방문 기록 카드 목록 → 방문 추가.
 * 하단 탭바(기록 활성)가 오버레이. 조립·조회는 `pages/trip-records` 가 진다(이 파일은
 * `@/shared/api` 를 import 하지 않는다 — 프리뷰 격리 렌더 안전, FSD 경계).
 *
 * 완료 방문 카드의 사진/메모는 페이지가 `renderCard` 로 실데이터 슬롯을 조립해 내려준다
 * (useVisitAttachments 는 훅이라 카드 map 안에서 못 부른다 → per-card 컨테이너). renderCard 가
 * 카드를 안 그리면(undefined) 정적 스캐폴딩 VisitRecordCard 로 폴백한다(프리뷰·빈 카드 무영향).
 *
 * ★ 지도(MapView) 위에 인터랙티브 요소를 얹지 않는다(repo-traps 터치 흡수 함정). 방문 추가
 * 버튼·카드는 지도 **아래 flow 형제**다. 지도는 viewOnly 글랜스(제스처 없음).
 */

export interface TripRecordsDayTab {
  day: string;
  label: string;
}

/**
 * TRIP-569 — 활성 일자의 귀속 헤더 완성값(라벨 조립은 페이지 몫). `stayName` 이 있으면 숙소명
 * 헤더, null/undefined 면 날짜만 헤더로 갈린다.
 */
export interface DayAttributionHeader {
  dayLabel: string;
  stayName?: string | null;
}

export interface TripRecordsScreenProps {
  dayTabs: TripRecordsDayTab[];
  activeDay: string;
  onSelectDay: (day: string) => void;
  mapCenter: MapCenter;
  mapPins?: MapPin[];
  cards: VisitRecordCardVM[];
  /** TRIP-569 — 활성 일자의 숙소·날짜 귀속 헤더(없으면 미표시, 후방호환 optional). */
  attribution?: DayAttributionHeader;
  /**
   * TRIP-760 — 부제 안내문(옵셔널). 상태별 의도(error 얼굴 등)를 페이지가 문자열로 내린다. 미주입 시
   * 현행 default 문자열을 유지한다(기존 호출자·프리뷰 무영향).
   */
  noticeCopy?: string;
  /**
   * TRIP-759 — 카드별 실데이터 렌더 훅(옵셔널). 페이지가 완료 방문 카드에 사진/메모 슬롯을 배선한
   * per-card 컨테이너를 돌려준다. undefined 를 돌려주면 정적 스캐폴딩 VisitRecordCard 로 폴백한다.
   */
  renderCard?: (card: VisitRecordCardVM) => ReactNode;
  /**
   * TRIP-761 — 수동 체크인 모드(옵셔널 — 미주입/false 면 일반 모드, 기존 호출자·프리뷰 무영향).
   * 페이지가 위치 권한 부재를 판정해 내린다. true 면 GPS 미동의 배너 + 지도 ⊘ 배지가 뜨고, UPCOMING
   * 카드로 `manualCheckin`·`onPressManualCheck` 를 전달해 "방문 체크" pill 을 켠다(BR-U5-54).
   */
  manualCheckin?: boolean;
  /** TRIP-761 — UPCOMING 카드 "방문 체크" press 를 페이지로 올린다(arg = card.poiId → arrive MANUAL). */
  onPressManualCheck?: (poiId: string) => void;
  onPressComplete: (visitCheckId: string) => void;
  onPressSkip: (visitCheckId: string) => void;
  onPressSpontaneous: () => void;
  onPressBack?: () => void;
  onPressTab?: (key: ShellTabKey) => void;
}

export function TripRecordsScreen({
  dayTabs,
  activeDay,
  onSelectDay,
  mapCenter,
  mapPins,
  cards,
  attribution,
  noticeCopy,
  renderCard,
  manualCheckin,
  onPressManualCheck,
  onPressComplete,
  onPressSkip,
  onPressSpontaneous,
  onPressBack,
  onPressTab,
}: TripRecordsScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }} className="bg-canvas">
      {/* appbar */}
      <View className="w-full flex-row items-center gap-[4px] bg-canvas pb-[12px] pl-[12px] pr-lg pt-[4px]">
        <Pressable
          testID="record-trip-back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onPressBack}
        >
          <BackArrowGlyph size={24} />
        </Pressable>
        <Text className="font-noto-bold text-[18px] text-ink">방문 기록</Text>
      </View>

      {/* TRIP-761 GPS 미동의 배너 — 수동 체크인 모드에서만(권한 부재). appbar 아래·일자 탭 위(Figma
          1562:1947). 연회색 dashed 박스에 ⓘ + 제목·본문. 카피는 사용자 가시 문자열이라 자구가 계약
          (BR-U5-54). 색·dashed 보더·폰트 미세치(13.5/12.5)는 jest 사각(6-b 육안). */}
      {manualCheckin ? (
        <View className="w-full bg-canvas px-lg pb-[8px] pt-[2px]">
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
        </View>
      ) : null}

      {/* 일자 탭 */}
      <View className="w-full flex-row gap-sm bg-canvas px-lg pb-[10px] pt-[4px]">
        {dayTabs.map((tab) => {
          const active = tab.day === activeDay;
          return (
            <Pressable
              key={tab.day}
              testID={`record-trip-day-tab-${tab.day}`}
              onPress={() => onSelectDay(tab.day)}
              className={`rounded-pill px-lg py-sm ${
                active
                  ? 'bg-primary'
                  : 'border border-hairline-strong bg-canvas'
              }`}
            >
              <Text
                className={`text-label ${
                  active ? 'font-noto-bold text-white' : 'text-ink'
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 지도 히어로(250px 고정 블록 — 인터랙티브 요소의 형제, viewOnly 글랜스) */}
      <View className="h-[250px] w-full">
        <MapView
          center={mapCenter}
          pins={mapPins}
          viewOnly
          showZoomControls
          showScaleBar
        />
        {/* TRIP-761 ⊘ "GPS 자동기록 꺼짐" 배지 — 수동 체크인 모드에서만. MapView 의 **형제** absolute
            오버레이라 지도 위에 얹히되 글랜스(viewOnly)를 안 가린다. ★testID 노드 자신이
            `pointerEvents="none"` 를 들어 지도 터치를 흡수하지 않는다(A3a 단언 — jest 가 볼 수 있는
            유일한 예방 그물; 실제 덮음·터치통과·색은 6-b). */}
        {manualCheckin ? (
          <View
            testID="record-map-gps-off"
            pointerEvents="none"
            className="absolute left-[12px] top-[12px] flex-row items-center gap-[6px] rounded-[8px] border-[1.2px] border-dashed border-muted-soft bg-canvas/90 px-[10px] py-[6px]"
          >
            <GpsOffGlyph size={15} />
            <Text className="text-micro text-muted">GPS 자동기록 꺼짐</Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-md px-lg pb-[120px] pt-[14px]"
      >
        {/* TRIP-569 일자별 귀속 헤더 — "숙소 있음/없음"을 색이 아니라 상호배타 testID 로 가른다
            (SVG fill 사각 회피, repo 관례). 숙소명·날짜 라벨은 각자 별 Text leaf 다. */}
        {attribution ? (
          attribution.stayName ? (
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
          ) : (
            <View testID="record-trip-attribution-date" className="w-full">
              <Text className="text-label text-muted">
                {attribution.dayLabel}
              </Text>
            </View>
          )
        ) : null}

        <Text className="w-full text-label text-muted">
          {noticeCopy ?? '오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요'}
        </Text>

        {/* 카드 목록 — 페이지가 renderCard 를 주면 그것으로(완료 카드=실데이터 사진/메모 슬롯),
            안 주거나 undefined 를 돌려주면 정적 스캐폴딩 VisitRecordCard 로 폴백한다. key 는 감싸는
            Fragment 가 쥔다 — 방문이 바뀌면 리마운트돼 MemoInline 초안이 새로 심긴다(seed-once). */}
        {cards.map((card) => (
          <Fragment key={card.visitCheckId}>
            {renderCard?.(card) ?? (
              <VisitRecordCard
                card={card}
                manualCheckin={manualCheckin}
                onPressManualCheck={onPressManualCheck}
                onPressComplete={onPressComplete}
                onPressSkip={onPressSkip}
              />
            )}
          </Fragment>
        ))}

        <SpontaneousVisitButton onPress={onPressSpontaneous} />
      </ScrollView>

      <BottomTabBar activeKey="records" onPressTab={onPressTab ?? (() => {})} />
    </SafeAreaView>
  );
}
