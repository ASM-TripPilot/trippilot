import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapView, type MapCenter, type MapPin } from '@/shared/map';
import { RevealItem } from '@/shared/ui/RevealItem';
import { RecordNavBar } from '@/widgets/bottom-nav-bar';

import {
  LocationOffGlyph,
  MAGAZINE_TONES,
  MagazineCover,
  MagazineQuote,
  MagazineRoute,
  MagazineStats,
  type RecordBarNav,
  type SummaryMagazineVM,
} from '@/features/reflection/index.view';
import { DayHighlightCard } from './DayHighlightCard';

/**
 * TRIP-572 · j04 여행 요약 화면(순수 프레젠테이션 — VM·콜백 주입, 조회/조립 0). TRIP-1666 에서 매거진형으로 바뀌었다:
 * 표지 → 인용문(`이번 여행`) → 일차 카드 → 숫자 타일 → [위치 기록 없음 안내] → 동선 → 일차 회고 칩 순으로 이어 그린다.
 * 조립(표지 제목·색·거리 문구·동선 번호)은 `buildSummaryMagazineVM` 이 하고, 이 화면은 `vm` 을 받아 부품(`features/reflection`
 * 의 `MagazineCover|Quote|Stats|Route`)에 끼울 뿐 `ready`·`hasLocationData`·거리 대시를 자체 해석하지 않는다
 * (571 DailyReflectionScreen 동형 — 화면이 폴백을 발명하면 심판 사각이 생긴다). `@/shared/*`·형제 `features/reflection/index.view`
 * 만 import — 프리뷰 격리 렌더 안전.
 *
 * 무엇을 보장하나(승인 계약):
 *  - AC-2(BR-U5-39): view VISIT_LIST → 지도 노드 부재 + 점선 안내. 일차 카드·동선은 두 얼굴 공통(위치 기록이 없어도 방문 기록은 있다).
 *  - AC-5(BR-U5-48): shareEnabled:false → 공유 버튼 비활성 + press 콜백 0회(종료·요약 전 공유 불가).
 *  - 등장: 인용문 0 → 일차 카드 1.. → 동선 정류장이 이어서, 첫 지연 1050ms(경로 그리기 0.15+0.9초가 끝난 뒤).
 *
 * 지도는 `shared/map/MapView`(viewOnly 글랜스) — 실 좌표(mapCenter+mapPins)가 있을 때만 렌더하고 없으면 그 자리를 비운다
 * (가짜 기본 센터 지도 금지, 571 경고-2 동형 · 자리표시 제거 TRIP-939). `DayHighlight` 계약에 좌표가 없어 런타임은 늘 빈 가지다.
 */

export type SummaryViewMode = 'MAP' | 'VISIT_LIST';

export interface DayReflectionVM {
  /** 1-기반 여행 일차 — j03 일차 탭과 같은 번호. */
  day: number;
  label: string;
}

export interface TripSummaryScreenProps {
  vm: SummaryMagazineVM;
  view: SummaryViewMode;
  mapCenter?: MapCenter;
  mapPins?: MapPin[];
  shareEnabled: boolean;
  /** TRIP-939 — 미주입이면 [공유]를 그리지 않는다(공유 카드 미장전 시 페이지가 넘기지 않음). */
  onShare?: () => void;
  /** TRIP-1584 — 하단 바(기록·회고·요약)의 칸 이동 콜백 묶음. 미주입이면 바를 그리지 않는다(프리뷰·무회귀 테스트). */
  recordBar?: RecordBarNav;
  /** TRIP-987 — 여행 기간 전체 일차의 회고 진입(j03). 비었으면 칩 줄을 그리지 않는다. */
  dayReflections?: DayReflectionVM[];
  onPressDayReflection?: (day: number) => void;
}

/** TRIP-1386 · 다녀온 길 다시 그리기 — 0.15초 뒤 0.9초(모션 명세 「여행 요약」). 모듈 상수라 렌더마다 같은 참조. */
const DRAW_PATH = { durationMs: 900, delayMs: 150 };

/** 첫 카드가 나오기까지의 지연(ms) — 경로 그리기(0.15초 지연 + 0.9초)가 끝난 뒤. */
const FIRST_REVEAL_DELAY_MS = 1050;

export function TripSummaryScreen({
  vm,
  view,
  mapCenter,
  mapPins,
  shareEnabled,
  onShare,
  recordBar,
  dayReflections = [],
  onPressDayReflection,
}: TripSummaryScreenProps): ReactElement {
  // disabled 는 fireEvent.press 를 항상 막지는 않으므로(RNTL) 콜백 게이트를 한 번 더 둔다(571 저장버튼 동형).
  const handleShare = () => {
    if (!shareEnabled) return;
    onShare?.();
  };
  const hasMap =
    view === 'MAP' && mapCenter !== undefined && (mapPins?.length ?? 0) > 0;
  // 등장 순번 — 인용문이 있으면 0, 일차 카드는 그 뒤, 동선 정류장은 카드 뒤에서 이어진다.
  const quoteCount = vm.quote ? 1 : 0;
  const routeFirstIndex = quoteCount + vm.days.length;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }} className="bg-canvas">
      {/* 헤더 — 제목 · 공유(코랄, ready 로 활성). TRIP-1584: ‹ 는 하단 바 뒤로로 옮겼다. */}
      <View className="w-full flex-row items-center bg-canvas px-lg pb-[12px] pt-[4px]">
        <Text className="font-noto-bold text-[18px] font-bold text-ink">
          여행 요약
        </Text>
        <View className="flex-1" />
        {onShare ? (
          <Pressable
            testID="reflection-summary-share"
            disabled={!shareEnabled}
            accessibilityState={{ disabled: !shareEnabled }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={handleShare}
          >
            <Text
              className={`font-noto-bold text-body font-bold ${
                shareEnabled ? 'text-primary' : 'text-muted-soft'
              }`}
            >
              공유
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        className="flex-1"
        style={{ backgroundColor: MAGAZINE_TONES.paper }}
        // pb-[120px] — 하단 바(오버레이) 위로 콘텐츠가 가리지 않게 여백을 둔다(j03 default 동형).
        contentContainerClassName="pb-[120px]"
      >
        <MagazineCover
          cover={vm.cover}
          testID="reflection-summary-cover"
          titleTestID={
            vm.tripTitleKnown ? 'reflection-summary-trip-title' : undefined
          }
        />

        {hasMap ? (
          <>
            {/* 풀폭 250h. 실 좌표가 없으면 지도 자리에 아무것도 그리지 않는다 — 하드코딩 기본 센터는 거짓 정보(571 경고-2). */}
            <View className="h-[250px] overflow-hidden">
              <MapView
                center={mapCenter}
                pins={mapPins}
                viewOnly
                drawPathOnMount={DRAW_PATH}
              />
            </View>
            <Text className="px-xl pt-sm font-noto text-caption text-muted">
              코랄 선 = 이동 경로 · 숙 = 거점 숙소
            </Text>
          </>
        ) : null}

        {vm.quote ? (
          <RevealItem index={0} firstDelayMs={FIRST_REVEAL_DELAY_MS}>
            <MagazineQuote
              quote={vm.quote}
              heading="이번 여행"
              testID="reflection-summary-narrative"
            />
          </RevealItem>
        ) : null}

        {vm.days.length > 0 ? (
          <View className="gap-lg">
            {vm.days.map((day, index) => (
              <RevealItem
                key={day.key}
                index={index + quoteCount}
                firstDelayMs={FIRST_REVEAL_DELAY_MS}
              >
                <DayHighlightCard day={day} />
              </RevealItem>
            ))}
          </View>
        ) : null}

        <MagazineStats stats={vm.stats} testID="reflection-summary-stats" />

        {view === 'VISIT_LIST' ? (
          <View className="gap-sm px-xl pt-sm">
            {/* 위치 전무 — 빈 지도 대신 안내(BR-U5-39). 폴백 박스는 1줄(사유)만, 안내 두번째 문장은 박스 밖 좌측(Figma 1572:2050 정합). */}
            <View className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong bg-surface-soft px-lg py-3xl">
              <LocationOffGlyph size={30} />
              <Text className="text-center font-noto text-label text-muted">
                위치 기록이 없어 지도를 표시할 수 없어요
              </Text>
            </View>
            {/* 방문 0곳이면 "대신…" 은 거짓 약속이다 — 그 자리에 빈 문구(QA #025, 문구 출처 없음 Seed Q5). */}
            {vm.route.length > 0 ? (
              <Text className="font-noto text-label text-muted">
                대신 방문 장소를 순서대로 보여드릴게요
              </Text>
            ) : (
              <Text
                testID="reflection-summary-visit-empty"
                className="font-noto text-label text-muted"
              >
                기록된 방문 장소가 없어요
              </Text>
            )}
          </View>
        ) : null}

        {vm.route.length > 0 ? (
          <View className="pt-lg">
            <MagazineRoute
              route={vm.route}
              heading="여행 동선"
              palette={vm.routePalette}
              testID="reflection-summary-route"
              stopTestID="reflection-summary-visit-item"
              firstIndex={routeFirstIndex}
              firstDelayMs={FIRST_REVEAL_DELAY_MS}
            />
          </View>
        ) : null}

        {/* TRIP-987 — 일차 회고(j03) 칩. Figma j04 에 없는 요소라 j03 일차 탭·StateNotice outline 선례 토큰으로 그린다. */}
        {dayReflections.length > 0 ? (
          <View className="flex-row flex-wrap gap-sm px-xl pt-lg">
            {dayReflections.map((item) => (
              <Pressable
                key={item.day}
                testID={`reflection-summary-day-reflection-${item.day}`}
                accessibilityRole="button"
                onPress={() => onPressDayReflection?.(item.day)}
                className="rounded-pill border border-hairline-strong bg-canvas px-lg py-sm"
              >
                <Text className="text-label text-ink">{item.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* 하단 바(요약 활성) — 전 얼굴 공통 오버레이(absolute, j03 동형). */}
      {recordBar ? (
        <RecordNavBar
          testIDPrefix="reflection-summary-bottom-bar"
          active="summary"
          {...recordBar}
        />
      ) : null}
    </SafeAreaView>
  );
}
