import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KakaoMapView, type MapCenter, type MapPin } from '@/shared/map';
import { BottomTabBar, type ShellTabKey } from '@/shared/ui/BottomTabBar';

import { SpontaneousVisitButton } from './SpontaneousVisitButton';
import { BackArrowGlyph, HeartGlyph } from './RecordGlyphs';
import { VisitRecordCard, type VisitRecordCardVM } from './VisitRecordCard';

/**
 * TRIP-565 · j01 방문 기록 화면(순수 프레젠테이션 — VM·콜백 주입, 조회/판정 0).
 *
 * 세로 컬럼: appbar → 일자 탭 → 지도 히어로(250px) → 부제 → 방문 기록 카드 목록 → 즉석 방문
 * 추가. 하단 탭바(기록 활성)와 저장 FAB 는 오버레이. 조립·조회는 `pages/trip-records` 가 진다
 * (이 파일은 `@/shared/api` 를 import 하지 않는다 — 프리뷰 격리 렌더 안전, FSD 경계).
 *
 * ★ 지도(KakaoMapView, WebView) 위에 인터랙티브 요소를 얹지 않는다(repo-traps 터치 흡수 함정).
 * 즉석 방문 버튼·카드는 지도 **아래 flow 형제**이고, 저장 FAB 는 지도 밖(하단) 절대배치라 겹치지
 * 않는다. 지도는 viewOnly 글랜스(제스처 없음).
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
        <KakaoMapView center={mapCenter} pins={mapPins} viewOnly />
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
          오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요
        </Text>

        {cards.map((card) => (
          <VisitRecordCard
            key={card.visitCheckId}
            card={card}
            onPressComplete={onPressComplete}
            onPressSkip={onPressSkip}
          />
        ))}

        <SpontaneousVisitButton onPress={onPressSpontaneous} />
      </ScrollView>

      {/* 저장 FAB — 지도 밖(하단 우측) 절대배치, 탭바 위. */}
      <View
        testID="record-trip-saved-fab"
        className="absolute bottom-[104px] right-lg size-[56px] items-center justify-center rounded-full border border-hairline bg-canvas"
      >
        <HeartGlyph size={26} />
      </View>

      <BottomTabBar activeKey="records" onPressTab={onPressTab ?? (() => {})} />
    </SafeAreaView>
  );
}
