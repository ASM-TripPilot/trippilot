/**
 * d01 탐색 랜딩 화면 — 순수 프레젠테이션(US-EXPL-01 · BR-U1-05/09/12/14/15 · Figma d01/1672:1183).
 *
 * 이 파일은 `features/explore` 라 `placeExploreStructure.test.ts` 의 재귀 스캔에 자동 편입돼
 * `@/features/stay` import·훅·zustand·`duration`·URL 리터럴을 0건으로 강제받는다 — 그래서
 * 조회·`formatPrice`/`stayKey` 조합은 이 화면이 아니라 라우트(`(tabs)/explore.tsx`)가 진다.
 * 화면은 뷰모델(prop)만 받는다.
 *
 * 6구획(위→아래): 헤딩 · 검색 · axisSeg(4탭, '전체'만 활성) · 숙소 가로 레인 · 여행자 일정
 * 자리(준비 중) · 하단 bridgeBar(담은 곳 N곳 CTA / 0상태 안내). 여행자 일정은 1차엔 자리만
 * (BR-U1-05), 장소·'내 주변'은 스코프 밖이라 렌더하지 않는다.
 *
 * bridgeBar 는 탭바(오버레이) 위에 뜨는 고정 도크다 — 탭바 높이(84)만큼 위로 띄우고, 스크롤
 * 콘텐츠 하단 여백도 그만큼 확보해 마지막 항목이 안 가리게 한다(A7, `tabbarOverlay.test.ts`
 * AC-O3). 탭바는 SafeArea 를 모르는 순수 뷰라 하단 여백은 콘텐츠(이 화면) 쪽에 둔다(repo-trap).
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  InfoGlyph,
  SearchGlyph,
  WarningTriangleGlyph,
} from '@/features/explore/ui/ExploreGlyphs';

export interface StayCardVM {
  key: string;
  name: string;
  region: string;
  priceText: string;
}

export interface ExploreLandingScreenProps {
  heading: { title: string; subtitle: string };
  /** 검색창 탭 — 입력 불가 진입 버튼이다. 실제 검색은 /explore/region 에서만 한다(TRIP-412).
   * 제출이 아니라 진입이므로 텍스트를 넘기지 않는다(자유 문자열이 region 으로 새는 걸 막는다). */
  onPressSearch: () => void;
  stayLane: {
    error: boolean;
    cards: StayCardVM[];
    onRetry: () => void;
    onSeeAll: () => void;
  };
  bridge: { savedCount: number; onPressCreateTrip: () => void };
}

// 탭바(h-[84px]) 오버레이 위로 bridgeBar 를 띄우는 기준값. 스크롤 하단 여백도 이 위에 얹는다.
const TAB_BAR_CLEARANCE = 84;

// axisSeg 4탭 — '전체'만 활성(A9). 나머지 3탭은 눌러도 무동작이라 onPress 를 안 준다.
const AXES: { key: string; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'stay', label: '숙소' },
  { key: 'place', label: '장소' },
  { key: 'itin', label: '여행자 일정' },
];

function AxisSegment(): ReactElement {
  return (
    <View className="mt-lg flex-row gap-xs rounded-pill bg-surface-soft p-xs">
      {AXES.map((axis) => {
        const selected = axis.key === 'all';
        return (
          <Pressable
            key={axis.key}
            testID={`explore-axis-${axis.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            className={`flex-1 items-center rounded-pill py-sm ${
              selected ? 'bg-canvas' : ''
            }`}
          >
            <Text
              className={
                selected
                  ? 'font-noto-bold text-label font-bold text-ink'
                  : 'font-noto text-label text-muted'
              }
            >
              {axis.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function LaneHeader({
  title,
  onSeeAll,
  seeAllTestID,
}: {
  title: string;
  onSeeAll?: () => void;
  seeAllTestID?: string;
}): ReactElement {
  return (
    <View className="mb-md flex-row items-center justify-between">
      <Text className="font-noto-bold text-section font-bold text-ink">
        {title}
      </Text>
      {onSeeAll && seeAllTestID ? (
        <Pressable
          testID={seeAllTestID}
          accessibilityRole="button"
          onPress={onSeeAll}
          className="flex-row items-center gap-xs"
        >
          <Text className="font-noto text-label text-muted">모두 보기</Text>
          <Text className="font-noto text-label text-muted">›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function StayCard({ card }: { card: StayCardVM }): ReactElement {
  // 사진은 계약(StayItem)에 URL 필드가 없어 회색 자리(surface-strong)로 둔다 — URL 을
  // 지어내지 않는다(INV-1). 메타는 이름·지역·최저가뿐: 거리·소요시간 데이터가 없다(INV-3).
  return (
    <View testID={`explore-stay-card-${card.key}`} className="w-[200px]">
      <View className="h-[130px] w-full rounded-card bg-surface-strong" />
      <Text
        numberOfLines={1}
        className="mt-sm font-noto-bold text-card-title font-bold text-ink"
      >
        {card.name}
      </Text>
      <Text numberOfLines={1} className="mt-xs font-noto text-label text-muted">
        {card.region}
      </Text>
      <Text className="mt-xs font-noto-bold text-card-title font-bold text-ink">
        {card.priceText}
      </Text>
    </View>
  );
}

function StayLaneError({ onRetry }: { onRetry: () => void }): ReactElement {
  // 부분 실패 — 침묵하지 않고 자리에 재시도를 띄운다(US-EXPL-01 · INV-4). 나머지 구획은 산다.
  return (
    <View className="items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl">
      <WarningTriangleGlyph size={28} tone="primary" />
      <Text className="font-noto text-label text-muted">
        숙소를 불러오지 못했어요
      </Text>
      <Pressable
        testID="explore-lane-stay-retry"
        accessibilityRole="button"
        onPress={onRetry}
        className="rounded-button border border-hairline-strong bg-canvas px-lg py-sm"
      >
        <Text className="font-noto-bold text-label font-bold text-ink">
          다시 시도
        </Text>
      </Pressable>
    </View>
  );
}

export function ExploreLandingScreen({
  heading,
  onPressSearch,
  stayLane,
  bridge,
}: ExploreLandingScreenProps): ReactElement {
  const hasSaved = bridge.savedCount >= 1;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="explore-landing" className="flex-1 bg-canvas">
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingTop: 12,
            paddingHorizontal: 16,
            paddingBottom: 156,
          }}
        >
          {/* 헤딩 */}
          <View testID="explore-landing-heading">
            <Text className="font-noto-bold text-hero font-bold text-ink">
              {heading.title}
            </Text>
            <Text className="mt-xs font-noto text-label text-muted">
              {heading.subtitle}
            </Text>
          </View>

          {/* 검색 — 입력 불가 진입 버튼(TRIP-412). 탭하면 /explore/region 으로 간다. */}
          <Pressable
            testID="explore-landing-search"
            accessibilityRole="button"
            onPress={onPressSearch}
            className="mt-lg h-[52px] flex-row items-center gap-sm rounded-pill border border-hairline-strong bg-canvas px-lg"
          >
            <SearchGlyph size={20} />
            <Text className="flex-1 font-noto text-body text-muted-soft">
              도시 · 장소 · 숙소 검색
            </Text>
          </Pressable>

          {/* axisSeg — 전체만 활성 */}
          <AxisSegment />

          {/* 숙소 가로 레인 */}
          <View testID="explore-lane-stay" className="mt-2xl">
            <LaneHeader
              title="숙소"
              onSeeAll={stayLane.onSeeAll}
              seeAllTestID="explore-lane-stay-seeall"
            />
            {stayLane.error ? (
              <StayLaneError onRetry={stayLane.onRetry} />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-md">
                  {stayLane.cards.map((card) => (
                    <StayCard key={card.key} card={card} />
                  ))}
                </View>
              </ScrollView>
            )}
          </View>

          {/* 여행자 일정 — 자리만(BR-U1-05) */}
          <View testID="explore-lane-itin" className="mt-2xl">
            <LaneHeader title="여행자 일정" />
            <View className="flex-row items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl">
              <InfoGlyph size={18} />
              <Text className="font-noto text-label text-muted">
                여행자들의 일정을 준비 중이에요
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* bridgeBar — 탭바 위 고정 도크. 담은 곳 ≥1 → CTA, 0 → 안내(BR-U1-09) */}
        <View
          className="absolute inset-x-0 px-lg"
          style={{ bottom: TAB_BAR_CLEARANCE }}
        >
          {hasSaved ? (
            <Pressable
              testID="explore-bridge-cta"
              accessibilityRole="button"
              onPress={bridge.onPressCreateTrip}
              className="h-14 flex-row items-center justify-center gap-sm rounded-pill bg-primary px-lg"
            >
              <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                ♥
              </Text>
              <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                담은 곳 {bridge.savedCount}곳 · 여행 만들기
              </Text>
              <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                ›
              </Text>
            </Pressable>
          ) : (
            <View
              testID="explore-bridge-empty"
              className="flex-row items-center gap-sm rounded-pill border border-hairline-strong bg-canvas px-lg py-md"
            >
              <InfoGlyph size={18} />
              <Text className="flex-1 font-noto text-label text-muted">
                아직 담은 곳이 없어요. 위 검색으로 마음에 드는 곳을 담아보세요.
              </Text>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
