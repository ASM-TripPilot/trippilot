/**
 * a01-home "발견·영감 피드" 프레젠테이션 화면 (TRIP-316 · 라이브 Figma 2091:1357 정합, 3상태).
 * props(hero·sections)만 받는다 — 네트워크·라우팅을 전혀 모른다(homeStructure D-1이 기계 강제).
 * CTA는 전부 no-op — onPress 미배선, accessibilityRole="button"만 유지한다.
 *
 * 구성: 인사 헤더 → 검색바 → magazineHero(영감 카드) → "요즘 사람들이 담는 곳"(가로 스크롤) →
 * "지금 뜨는 장소"(2×2 그리드) → "여행자 일정"(가로 스크롤) → softNote(장소 온램프) → FAB.
 * 사진 에셋은 미번들이라 토큰색 플레이스홀더 + 스크림 그라디언트로 대체한다(가정 C).
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BellGlyph,
  HeartOutlineGlyph,
  LocationPinGlyph,
  PlusGlyph,
  SearchGlyph,
  SparkleGlyph,
} from './HomeGlyphs';
import type {
  HomeCollectionCard,
  HomeItineraryCard,
  HomeMagazineHero,
  HomeScreenProps,
  HomeSections,
  HomeSpotCard,
} from '../model/homeTypes';

// 사진 위 흰 글씨 가독성을 위한 스크림 그라디언트(브리프 §3-D 명시 raw 허용 — 스크림은 토큰
// 대상이 아니다). 상단 30%는 투명, 하단은 검정. 카드별 하단 농도만 Figma 실측대로 다르다.
const SCRIM_LOCATIONS = [0.3, 1] as const;
const HERO_SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.8)'] as const;
const DEST_SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)'] as const;
const SPOT_SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.66)'] as const;

const ABSOLUTE_FILL = StyleSheet.absoluteFillObject;

// hero 메타칩 반투명 흰 배경(브리프 §3-C 명시 raw 예외 — 알파는 토큰이 아니다).
const HERO_CHIP_STYLE = { backgroundColor: 'rgba(255,255,255,0.22)' } as const;

// 카드 그림자 2종(브리프 §3-D 명시 raw 허용 — 그림자는 토큰 대상이 아니다). RN은 box-shadow가
// 없어 shadow-* 스타일 프로퍼티로 옮긴다. shadowColor '#000000'은 D-3 13색 밖이라 무제재.
const softCardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

const fabShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.22,
  shadowRadius: 16,
  elevation: 8,
} as const;

// ── 인사 헤더 ───────────────────────────────────────────────────────────
function GreetingHeader(): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-sm px-lg pb-[10px] pt-lg">
      <View testID="home-greeting" className="flex-1 gap-px">
        <Text className="font-noto-bold text-[21px] font-bold text-ink">
          오늘은 어디를 상상해볼까요
        </Text>
        <Text className="font-noto text-[12.5px] text-muted">
          떠나지 않아도, 구경하고 모으는 즐거움
        </Text>
      </View>
      <Pressable
        testID="home-dashboard-bell"
        accessibilityRole="button"
        onPress={undefined}
        className="h-10 w-10 items-center justify-center"
      >
        <BellGlyph size={22} />
        <View className="absolute right-[8px] top-[8px] h-[7px] w-[7px] rounded-pill bg-primary" />
      </Pressable>
    </View>
  );
}

// ── 검색바(가짜 — Pressable+Text, 실 TextInput 아님 · 02a §4-8) ──────────
function SearchBarBlock(): ReactElement {
  return (
    <View className="w-full px-lg pb-[14px] pt-[4px]">
      <Pressable
        testID="home-search-bar"
        accessibilityRole="button"
        onPress={undefined}
        className="w-full flex-row items-center gap-[10px] rounded-pill bg-surface-soft px-lg py-[13px]"
      >
        <SearchGlyph size={19} />
        <Text className="font-noto text-body text-muted-soft">
          가고 싶은 도시·장소를 검색해보세요
        </Text>
      </Pressable>
    </View>
  );
}

// ── magazineHero(영감 카드) ─────────────────────────────────────────────
function MagazineHero({ hero }: { hero: HomeMagazineHero }): ReactElement {
  return (
    <View
      testID="home-magazine-hero"
      className="h-[470px] w-full overflow-hidden"
    >
      {/* 사진 자리 — 실 사진 소스 없음(가정 C) → 토큰색 플레이스홀더 + 스크림 */}
      <View className="absolute inset-0 bg-surface-strong" />
      <LinearGradient
        colors={HERO_SCRIM_COLORS}
        locations={SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="flex-1 justify-between px-lg pb-xl pt-xl">
        {/* 상단: eyebrow pill + 하트 */}
        <View className="w-full flex-row items-start justify-between">
          <View className="flex-row items-center gap-[6px] self-start rounded-pill bg-canvas px-md py-[5px]">
            <SparkleGlyph size={13} />
            <Text className="font-noto-bold text-[11.5px] font-bold text-ink">
              {hero.eyebrow}
            </Text>
          </View>
          <HeartOutlineGlyph size={30} />
        </View>
        {/* 하단: 타이틀 + 부제 + 메타칩 + 3-dot */}
        <View className="w-full gap-[10px]">
          <View className="gap-[6px]">
            <Text className="font-noto-bold text-[28px] font-bold text-on-primary">
              {hero.title}
            </Text>
            <Text className="font-noto text-[13.5px] text-on-primary opacity-90">
              {hero.subtitle}
            </Text>
          </View>
          <View className="flex-row gap-sm">
            {hero.chips.map((chip) => (
              <View
                key={chip}
                style={HERO_CHIP_STYLE}
                className="rounded-pill px-[10px] py-[4px]"
              >
                <Text className="font-noto-bold text-micro font-bold text-on-primary">
                  {chip}
                </Text>
              </View>
            ))}
          </View>
          <View className="flex-row items-center gap-[5px] pt-[4px]">
            <View className="h-[6px] w-[18px] rounded-pill bg-on-primary" />
            <View className="h-[6px] w-[6px] rounded-pill bg-on-primary opacity-50" />
            <View className="h-[6px] w-[6px] rounded-pill bg-on-primary opacity-50" />
          </View>
        </View>
      </View>
    </View>
  );
}

// ── 공용 섹션 헤더(타이틀 + '더 보기') ──────────────────────────────────
function SectionHeader({
  title,
  moreTestID,
}: {
  title: string;
  moreTestID: string;
}): ReactElement {
  return (
    <View className="w-full flex-row items-center justify-between px-lg">
      <Text className="font-noto-bold text-section font-bold text-ink">
        {title}
      </Text>
      <Pressable
        testID={moreTestID}
        accessibilityRole="button"
        onPress={undefined}
      >
        <Text className="font-noto-bold text-[12.5px] font-bold text-muted underline">
          더 보기
        </Text>
      </Pressable>
    </View>
  );
}

// ── 섹션 빈 플레이스홀더(AC-4 · 침묵 은닉 금지) ─────────────────────────
function SectionEmptyBlock({ testID }: { testID: string }): ReactElement {
  return (
    <View
      testID={testID}
      className="mx-lg items-center gap-[6px] rounded-card border border-hairline bg-canvas-alt px-lg py-[26px]"
    >
      <Text className="text-center font-noto-bold text-card-title font-bold text-ink">
        아직 보여드릴 게 없어요
      </Text>
      <Text className="text-center font-noto text-label text-muted">
        담아둔 장소가 쌓이면 여기에 골라 담아 드려요
      </Text>
    </View>
  );
}

// ── 컬렉션 카드(요즘 사람들이 담는 곳) ──────────────────────────────────
function CollectionCard({
  card,
  index,
}: {
  card: HomeCollectionCard;
  index: number;
}): ReactElement {
  return (
    <View
      testID={`home-collection-card-${index}`}
      style={softCardShadow}
      className="h-[300px] w-[230px] overflow-hidden rounded-[18px]"
    >
      <View className="absolute inset-0 bg-surface-strong" />
      <LinearGradient
        colors={DEST_SCRIM_COLORS}
        locations={SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="absolute inset-x-0 top-[12px] flex-row items-center justify-between px-[12px]">
        <View className="rounded-pill bg-primary px-[10px] py-[4px]">
          <Text className="font-noto-bold text-[10.5px] font-bold text-on-primary">
            {card.badge}
          </Text>
        </View>
        <HeartOutlineGlyph size={26} />
      </View>
      <View className="absolute inset-x-0 bottom-[16px] gap-[6px] px-[14px]">
        <Text className="font-noto-bold text-[18px] font-bold text-on-primary">
          {card.title}
        </Text>
        <View className="flex-row items-center gap-[4px]">
          <LocationPinGlyph size={12} />
          <Text className="font-noto text-micro text-on-primary opacity-90">
            {card.region}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── 스팟 카드(지금 뜨는 장소, 2×2 그리드 셀) ────────────────────────────
function SpotCard({
  card,
  index,
}: {
  card: HomeSpotCard;
  index: number;
}): ReactElement {
  return (
    <View
      testID={`home-spot-card-${index}`}
      className="h-[166px] flex-1 overflow-hidden rounded-card"
    >
      <View className="absolute inset-0 bg-surface-strong" />
      <LinearGradient
        colors={SPOT_SCRIM_COLORS}
        locations={SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="absolute right-[10px] top-[10px]">
        <HeartOutlineGlyph size={22} />
      </View>
      <View className="absolute inset-x-0 bottom-[12px] gap-[3px] px-[12px]">
        <Text className="font-noto-bold text-body font-bold text-on-primary">
          {card.title}
        </Text>
        <Text className="font-noto text-micro text-on-primary opacity-90">
          {card.tag}
        </Text>
      </View>
    </View>
  );
}

// ── 여행자 일정 카드(사진 + 본문) ───────────────────────────────────────
function ItineraryCard({
  card,
  index,
}: {
  card: HomeItineraryCard;
  index: number;
}): ReactElement {
  return (
    <View
      testID={`home-itinerary-card-${index}`}
      style={softCardShadow}
      className="w-[170px] overflow-hidden rounded-card border border-hairline bg-canvas"
    >
      <View className="h-[114px] w-full overflow-hidden bg-surface-strong">
        <View className="absolute right-[8px] top-[8px]">
          <HeartOutlineGlyph size={20} />
        </View>
      </View>
      <View className="gap-[7px] px-md pb-md pt-[10px]">
        <Text className="font-noto-bold text-body font-bold text-ink">
          {card.title}
        </Text>
        <Text className="font-noto text-[12.5px] text-muted">
          {card.nights}
        </Text>
      </View>
    </View>
  );
}

// ── 섹션1: 요즘 사람들이 담는 곳(가로 스크롤 · 3상태) ───────────────────
function CollectionsSection({
  sections,
}: {
  sections: HomeSections;
}): ReactElement {
  return (
    <View className="w-full gap-md">
      <SectionHeader
        title="요즘 사람들이 담는 곳"
        moreTestID="home-collections-more"
      />
      {sections.kind === 'ready' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        >
          {sections.collections.map((card, index) => (
            <CollectionCard key={card.title} card={card} index={index} />
          ))}
        </ScrollView>
      ) : sections.kind === 'empty' ? (
        <SectionEmptyBlock testID="home-collections-empty" />
      ) : (
        <View
          testID="home-collections-skeleton"
          className="mx-lg flex-row gap-md overflow-hidden"
        >
          {[0, 1].map((i) => (
            <View
              key={i}
              className="h-[300px] w-[230px] rounded-[18px] bg-surface-strong"
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ── 섹션2: 지금 뜨는 장소(2×2 그리드 · 3상태) ───────────────────────────
function SpotsSection({ sections }: { sections: HomeSections }): ReactElement {
  return (
    <View className="w-full gap-md">
      <SectionHeader title="지금 뜨는 장소" moreTestID="home-spots-more" />
      {sections.kind === 'ready' ? (
        <View className="mx-lg gap-md">
          {[0, 1].map((row) => (
            <View key={row} className="flex-row gap-md">
              {sections.spots.slice(row * 2, row * 2 + 2).map((card, i) => (
                <SpotCard key={card.title} card={card} index={row * 2 + i} />
              ))}
            </View>
          ))}
        </View>
      ) : sections.kind === 'empty' ? (
        <SectionEmptyBlock testID="home-spots-empty" />
      ) : (
        <View testID="home-spots-skeleton" className="mx-lg gap-md">
          {[0, 1].map((row) => (
            <View key={row} className="flex-row gap-md">
              {[0, 1].map((c) => (
                <View
                  key={c}
                  className="h-[166px] flex-1 rounded-card bg-surface-strong"
                />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── 섹션3: 여행자 일정(가로 스크롤 · 3상태) ─────────────────────────────
function ItinerariesSection({
  sections,
}: {
  sections: HomeSections;
}): ReactElement {
  return (
    <View className="w-full gap-md">
      <SectionHeader title="여행자 일정" moreTestID="home-itineraries-more" />
      {sections.kind === 'ready' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        >
          {sections.itineraries.map((card, index) => (
            <ItineraryCard key={card.title} card={card} index={index} />
          ))}
        </ScrollView>
      ) : sections.kind === 'empty' ? (
        <SectionEmptyBlock testID="home-itineraries-empty" />
      ) : (
        <View
          testID="home-itineraries-skeleton"
          className="mx-lg flex-row gap-md overflow-hidden"
        >
          {[0, 1].map((i) => (
            <View
              key={i}
              className="h-[175px] w-[170px] rounded-card bg-surface-strong"
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ── softNote(장소 온램프 · US-SHELL-05) ─────────────────────────────────
// 배경 #fff7f8은 Figma가 변수 아닌 raw fill로 쓴 값 → 임의 raw 유지(가정 D). D-3 13색 밖이라
// 자동 심판 사각지대이므로 [검증] 스크린샷 대조가 유일한 그물.
function SoftNote(): ReactElement {
  return (
    <View className="w-full px-lg pb-[24px] pt-[22px]">
      <View
        testID="home-soft-note"
        className="w-full flex-row items-center gap-[10px] rounded-card bg-[#fff7f8] px-lg py-[14px]"
      >
        <View className="flex-1 gap-[2px]">
          <Text className="font-noto-bold text-[13.5px] font-bold text-ink">
            마음에 든 곳이 모이면
          </Text>
          <Text className="font-noto text-[11.5px] text-muted">
            담아둔 장소로 여행을 만들 수 있어요
          </Text>
        </View>
        <Pressable
          testID="home-saved-places-cta"
          accessibilityRole="button"
          onPress={undefined}
          className="rounded-pill border-[1.4px] border-primary bg-canvas px-md py-sm"
        >
          <Text className="font-noto-bold text-caption font-bold text-primary-text">
            담은 곳
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── FAB(여행 만들기 · 우하단 floating) ──────────────────────────────────
// bottom 오프셋은 화면 쪽에서 직접 잡는다 — 탭바는 SafeArea/네비 모르는 순수 뷰 계약이라
// bottom inset을 합산하지 않는다(repo-trap). 탭바(약 96px)+홈 인디케이터 위에 뜨도록 하고,
// 실제 여백은 [검증] 6-b 실기 스모크에서 눈으로 조정한다(자동 심판 없음, 브리프 §8-4).
function CreateTripFab(): ReactElement {
  return (
    <Pressable
      testID="home-create-trip-fab"
      accessibilityRole="button"
      onPress={undefined}
      style={fabShadow}
      className="absolute bottom-[100px] right-lg flex-row items-center justify-center gap-sm rounded-pill bg-primary py-md pl-xl pr-[22px]"
    >
      <PlusGlyph size={22} />
      <Text className="font-noto-bold text-card-title font-bold text-on-primary">
        여행 만들기
      </Text>
    </Pressable>
  );
}

export function HomeScreen({ hero, sections }: HomeScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="home-dashboard-root" className="flex-1 bg-canvas">
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 140 }}
        >
          <GreetingHeader />
          <SearchBarBlock />
          <MagazineHero hero={hero} />
          <View className="w-full gap-[24px] pb-sm pt-[22px]">
            <CollectionsSection sections={sections} />
            <SpotsSection sections={sections} />
            <ItinerariesSection sections={sections} />
          </View>
          <SoftNote />
        </ScrollView>
        <CreateTripFab />
      </View>
    </SafeAreaView>
  );
}
