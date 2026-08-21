/**
 * d05 통합 검색 화면 — 순수 프레젠테이션(US-EXPL-01~04 · TRIP-450 · INV-4).
 *
 * 이 파일은 `features/explore` 라 `placeExploreStructure.test.ts` 의 재귀 스캔에 자동 편입돼
 * `@/features/stay` import·훅·zustand·`duration`·URL 리터럴을 0건으로 강제받는다 — 그래서
 * 3소스 조회·조합(특히 숙소 훅 `useStaySearch`)은 이 화면이 아니라 페이지
 * (`pages/unified-search/ui/UnifiedSearchPage.tsx`)가 지고, 화면은 뷰모델(prop)만 받는다.
 *
 * 세 섹션(위→아래): 여행지 · 장소 · 숙소. 각 섹션은 독립이라 한 소스가 실패해도 그 섹션만
 * 재시도를 띄우고 나머지는 산다(INV-4). 숙소는 2단 조회라 지역을 못 특정하면(=`noRegion`)
 * 카드 대신 이유를 알린다. 숙소 카드는 표시 전용(onPress 없음) — `/stays/[stayId]` 라우트가
 * 아직 없어(typedRoutes tsc 차단) 상세 이동은 후속이다(Seed Q2 · 검토 대기).
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BackChevronGlyph,
  InfoGlyph,
  SearchGlyph,
  WarningTriangleGlyph,
} from '@/features/explore/ui/ExploreGlyphs';

export interface UnifiedSearchRegionRow {
  code: string;
  name: string;
  onPress: () => void;
}

export interface UnifiedSearchPlaceCard {
  poiId: string;
  name: string;
  onPress: () => void;
}

export interface UnifiedSearchStayCard {
  key: string;
  name: string;
  priceText: string;
}

export interface UnifiedSearchScreenProps {
  /** 앱바 뒤로가기(TRIP-469 — RegionPickerScreen 과 패턴 통일). 목적지는 페이지가 정한다.
   * 미지정이면 정직한 스텁(버튼은 렌더되되 무동작). */
  onBack?: () => void;
  /** 검색창 현재 값 — 입력은 d05 에서 받는다(d01 은 Pressable 진입 버튼일 뿐). */
  searchText: string;
  onChangeSearch: (text: string) => void;
  /** 헤딩 문구 — 검색어를 되비친다(예: "'부산' 검색 결과"). */
  heading: string;
  region: {
    error: boolean;
    rows: UnifiedSearchRegionRow[];
    onRetry: () => void;
  };
  place: {
    error: boolean;
    cards: UnifiedSearchPlaceCard[];
    onRetry: () => void;
  };
  stay: {
    /** 지역을 못 특정함(2단 조회 불가) — 카드 대신 이유를 알린다. */
    noRegion: boolean;
    error: boolean;
    cards: UnifiedSearchStayCard[];
    onRetry: () => void;
  };
}

function SectionRetry({
  testID,
  onRetry,
}: {
  testID: string;
  onRetry: () => void;
}): ReactElement {
  // 부분 실패 — 침묵하지 않고 그 섹션 자리에 재시도를 띄운다(INV-4). 나머지 섹션은 산다.
  return (
    <View className="items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl">
      <WarningTriangleGlyph size={28} tone="primary" />
      <Text className="font-noto text-label text-muted">불러오지 못했어요</Text>
      <Pressable
        testID={testID}
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

function SectionTitle({ title }: { title: string }): ReactElement {
  return (
    <Text className="mb-md font-noto-bold text-section font-bold text-ink">
      {title}
    </Text>
  );
}

/** 사진 자리 — 계약에 URL 필드가 없어 회색 자리로 둔다(URL 을 지어내지 않는다, INV-1). */
function CardPhoto(): ReactElement {
  return (
    <View className="h-[110px] w-[150px] rounded-card bg-surface-strong" />
  );
}

export function UnifiedSearchScreen({
  onBack,
  searchText,
  onChangeSearch,
  heading,
  region,
  place,
  stay,
}: UnifiedSearchScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="explore-search-root" className="flex-1 bg-canvas">
        {/* 앱바 — RegionPickerScreen 과 같은 뒤로가기(TRIP-469). */}
        <View className="flex-row items-center gap-sm px-lg py-sm">
          <Pressable testID="explore-search-back" onPress={onBack} hitSlop={8}>
            <BackChevronGlyph />
          </Pressable>
        </View>
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingTop: 12,
            paddingHorizontal: 16,
            paddingBottom: 48,
          }}
        >
          {/* 헤딩 — 검색어 되비침 */}
          <Text
            testID="explore-search-heading"
            className="font-noto-bold text-hero font-bold text-ink"
          >
            {heading}
          </Text>
          <Text className="mt-xs font-noto text-label text-muted">
            여행지 · 장소 · 숙소에서 찾았어요
          </Text>

          {/* 검색창 — 입력은 여기(d05)에서 받는다(Figma node 2176:2341) */}
          <View className="mt-lg h-[52px] flex-row items-center gap-sm rounded-pill border border-hairline-strong bg-canvas px-lg">
            <SearchGlyph size={20} />
            <TextInput
              testID="explore-search-input"
              value={searchText}
              onChangeText={onChangeSearch}
              placeholder="도시 · 장소 · 숙소 검색"
              className="flex-1 font-noto text-body text-ink"
            />
          </View>

          {/* 여행지 섹션 — Figma 템플릿 부재라 단순 행 목록(Seed Q4) */}
          <View testID="explore-search-section-region" className="mt-2xl">
            <SectionTitle title="여행지" />
            {region.error ? (
              <SectionRetry
                testID="explore-search-region-retry"
                onRetry={region.onRetry}
              />
            ) : region.rows.length === 0 ? (
              <Text
                testID="explore-search-region-empty"
                className="py-2xl text-center font-noto text-label text-muted"
              >
                검색 결과가 없어요
              </Text>
            ) : (
              <View className="gap-xs">
                {region.rows.map((row) => (
                  <Pressable
                    key={row.code}
                    testID={`explore-search-region-${row.code}`}
                    accessibilityRole="button"
                    onPress={row.onPress}
                    className="flex-row items-center gap-sm rounded-card bg-surface-soft px-lg py-md"
                  >
                    <Text className="flex-1 font-noto-bold text-card-title font-bold text-ink">
                      {row.name}
                    </Text>
                    <Text className="font-noto text-label text-muted">›</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* 장소 섹션 — 가로 카드, 탭 → 상세 */}
          <View testID="explore-search-section-place" className="mt-2xl">
            <SectionTitle title="장소" />
            {place.error ? (
              <SectionRetry
                testID="explore-search-place-retry"
                onRetry={place.onRetry}
              />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-md">
                  {place.cards.map((card) => (
                    <Pressable
                      key={card.poiId}
                      testID={`explore-search-place-${card.poiId}`}
                      accessibilityRole="button"
                      onPress={card.onPress}
                      className="w-[150px]"
                    >
                      <CardPhoto />
                      <Text
                        numberOfLines={1}
                        className="mt-sm font-noto-bold text-card-title font-bold text-ink"
                      >
                        {card.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>

          {/* 숙소 섹션 — 표시 전용 카드(onPress 없음, Seed Q2). 지역 미특정이면 이유 알림 */}
          <View testID="explore-search-section-stay" className="mt-2xl">
            <SectionTitle title="숙소" />
            {stay.noRegion ? (
              <View
                testID="explore-search-stay-no-region"
                className="flex-row items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl"
              >
                <InfoGlyph size={18} />
                <Text className="flex-1 font-noto text-label text-muted">
                  이 검색어에 맞는 지역을 찾지 못해 숙소를 보여드릴 수 없어요
                </Text>
              </View>
            ) : stay.error ? (
              <SectionRetry
                testID="explore-search-stay-retry"
                onRetry={stay.onRetry}
              />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-md">
                  {stay.cards.map((card) => (
                    <View
                      key={card.key}
                      testID={`explore-search-stay-${card.key}`}
                      className="w-[200px]"
                    >
                      <View className="h-[130px] w-full rounded-card bg-surface-strong" />
                      <Text
                        numberOfLines={1}
                        className="mt-sm font-noto-bold text-card-title font-bold text-ink"
                      >
                        {card.name}
                      </Text>
                      <Text className="mt-xs font-noto-bold text-card-title font-bold text-ink">
                        {card.priceText}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
