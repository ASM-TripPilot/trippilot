/**
 * a01-home "발견·영감 피드" 프레젠테이션 화면 (TRIP-316 · 라이브 Figma 2091:1357 정합, 3상태).
 * props(hero·sections)만 받는다 — 네트워크·라우팅을 전혀 모른다(homeStructure D-1이 기계 강제).
 * 배선 CTA 3종(FAB·담은 곳·뜨는 장소 더보기)은 넘겨받은 콜백 prop만 발화하고(라우터 무지, D-1),
 * 목적지 없는 컨트롤은 accessibilityRole="button"을 떼 접근성 트리에서 버튼이 아니다(TRIP-370).
 *
 * 구성: 인사 헤더 → 검색바 → magazineHero(영감 카드) → "요즘 사람들이 담는 곳"(가로 스크롤) →
 * "지금 뜨는 장소"(2×2 그리드) → "여행자 일정"(가로 스크롤) → softNote(장소 온램프) → FAB.
 * 사진 에셋은 미번들이라 토큰색 플레이스홀더 + 스크림 그라디언트로 대체한다(가정 C).
 *
 * TRIP-317 — 여행 단계 얼굴 4종을 phase 판별값으로 얹는다(collecting·planning·upcoming·postTrip).
 * 화면은 phase.kind로 스위치만 하고 여행 데이터를 뜯어 단계를 스스로 도출하지 않는다(TRIP-206
 * S-6). phase 미전달/discovery → 316 얼굴 폴백. 각 얼굴은 브리프 §3 델타대로 공유 부품(tripHero·
 * softNote·미니맵 카드 등)을 단계 데이터로 파라미터화해 조립한다. INV-3(소요시간 미표시)는
 * 어떤 얼굴에도 소요시간 문자열·필드를 두지 않는다 — 시각(09:30)·거리(950m)만 표시한다.
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BellGlyph,
  CloseGlyph,
  HeartFilledGlyph,
  HeartOutlineGlyph,
  LocationPinGlyph,
  MapPinGlyph,
  PlusGlyph,
  SearchGlyph,
  SparkleGlyph,
  SuitcaseGlyph,
} from './HomeGlyphs';
import type {
  HomeCollectionCard,
  HomeItineraryCard,
  HomeMagazineHero,
  HomePhase,
  HomeScreenProps,
  HomeSections,
  HomeSpotCard,
  NextStop,
  PastTrip,
  TripHeroData,
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
// discovery는 고정 카피, 단계 얼굴은 greetTitle/greetSubtitle/greetName을 주입받는다.
function GreetingHeader({
  title,
  subtitle,
  name,
}: {
  title: string;
  subtitle?: string;
  name?: string;
}): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-sm px-lg pb-[10px] pt-lg">
      <View testID="home-greeting" className="flex-1 gap-px">
        {name ? (
          <Text className="font-noto-bold text-[21px] font-bold text-ink">
            {name}
          </Text>
        ) : null}
        <Text className="font-noto-bold text-[21px] font-bold text-ink">
          {title}
        </Text>
        {subtitle ? (
          <Text className="font-noto text-[12.5px] text-muted">{subtitle}</Text>
        ) : null}
      </View>
      <Pressable
        testID="home-dashboard-bell"
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
// TRIP-453: 검색바가 목적지(/explore/search)를 얻어 배선 컨트롤이 됐다 — role="button"은 콜백
// 유무로 파생하지 않고 항상 붙인다(버튼-집합 테스트가 콜백 미주입으로 렌더, FAB 선례). 라우팅은
// 라우트(`(tabs)/index.tsx`)가 지고 화면은 넘겨받은 onPress만 발화한다(homeStructure D-1).
function SearchBarBlock({ onPress }: { onPress?: () => void }): ReactElement {
  return (
    <View className="w-full px-lg pb-[14px] pt-[4px]">
      <Pressable
        testID="home-search-bar"
        accessibilityRole="button"
        onPress={onPress}
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
// asButton은 role(버튼으로 읽히는가)을, onMore는 press 핸들러를 각각 정한다 — 둘은 함께
// 움직이지 않는다: 배선 인스턴스(뜨는 장소)는 콜백이 안 넘어온 단위 테스트에서도 버튼이어야
// 하므로(370-AC-4) role은 콜백 유무가 아니라 구조로 굳힌다(비배선 더보기 2종은 role 제거).
function SectionHeader({
  title,
  moreTestID,
  onMore,
  asButton = false,
}: {
  title: string;
  moreTestID: string;
  onMore?: () => void;
  asButton?: boolean;
}): ReactElement {
  return (
    <View className="w-full flex-row items-center justify-between px-lg">
      <Text className="font-noto-bold text-section font-bold text-ink">
        {title}
      </Text>
      <Pressable
        testID={moreTestID}
        accessibilityRole={asButton ? 'button' : undefined}
        onPress={onMore}
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

// ── 컬렉션 카드(요즘 사람들이 담는 곳 · 내가 담은 곳 · 추천) ─────────────
// savedAtLabel이 있으면(collecting) 하단 메타를 저장일로, 없으면(discovery·추천) 지역+핀으로 그린다.
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
        {card.savedAtLabel ? (
          <Text className="font-noto text-micro text-on-primary opacity-90">
            {card.savedAtLabel}
          </Text>
        ) : (
          <View className="flex-row items-center gap-[4px]">
            <LocationPinGlyph size={12} />
            <Text className="font-noto text-micro text-on-primary opacity-90">
              {card.region}
            </Text>
          </View>
        )}
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
function SpotsSection({
  sections,
  onMore,
}: {
  sections: HomeSections;
  onMore?: () => void;
}): ReactElement {
  return (
    <View className="w-full gap-md">
      <SectionHeader
        title="지금 뜨는 장소"
        moreTestID="home-spots-more"
        onMore={onMore}
        asButton
      />
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

// ── tripHero(planning·upcoming 공용 여행 히어로 · 브리프 §3-C) ───────────
// 사진+스크림 · 좌상단 단계 pill · 우상단 대형 D-day · 좌하단 primary CTA + 여행명 + 기간 메타.
// TRIP-453: 카드 본체(home-trip-hero)를 Pressable 로 승격해 알약(home-trip-hero-cta)과 **같은
// onPress**(=onPressTripHeroCta)를 공유한다 — 목적지 규칙을 두 곳에 두지 않는다(신규 콜백 0).
// role="button"은 항상 붙인다(콜백 미주입 렌더의 버튼-집합 테스트가 구조적 role 을 요구, ★1).
// 중첩 Pressable 이라 알약 press 는 알약에서 멈추고 카드 본체로 안 번진다(이중발화 없음, ★3).
function TripHero({
  trip,
  onPress,
}: {
  trip: TripHeroData;
  onPress?: () => void;
}): ReactElement {
  return (
    <View className="w-full px-lg pt-[8px]">
      <Pressable
        testID="home-trip-hero"
        accessibilityRole="button"
        onPress={onPress}
        style={softCardShadow}
        className="h-[300px] w-full overflow-hidden rounded-[18px]"
      >
        <View className="absolute inset-0 bg-surface-strong" />
        <LinearGradient
          colors={HERO_SCRIM_COLORS}
          locations={SCRIM_LOCATIONS}
          style={ABSOLUTE_FILL}
        />
        <View className="flex-1 justify-between px-lg py-lg">
          <View className="w-full flex-row items-start justify-between">
            <View
              testID="home-trip-hero-badge"
              className="self-start rounded-pill bg-canvas px-md py-[5px]"
            >
              <Text className="font-noto-bold text-[11.5px] font-bold text-ink">
                {trip.badge}
              </Text>
            </View>
            <Text
              testID="home-trip-hero-dday"
              className="font-noto-bold text-[28px] font-bold text-on-primary"
            >
              {trip.dday}
            </Text>
          </View>
          <View className="w-full gap-[8px]">
            <Pressable
              testID="home-trip-hero-cta"
              accessibilityRole="button"
              onPress={onPress}
              className="self-start rounded-pill bg-primary px-lg py-sm"
            >
              <Text className="font-noto-bold text-caption font-bold text-on-primary">
                {trip.ctaLabel}
              </Text>
            </Pressable>
            <Text className="font-noto-bold text-[24px] font-bold text-on-primary">
              {trip.title}
            </Text>
            <Text className="font-noto text-[12.5px] text-on-primary opacity-90">
              {trip.meta}
            </Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

// ── nextStop(upcoming '가장 먼저 갈 곳' · 순번·시각·장소·영업시간+거리) ──
// INV-3: time은 방문 시각(09:30, INV-2 솔버검증값 표시 허용), placeMeta는 영업시간+거리 — 소요시간 아님.
function NextStopCard({ nextStop }: { nextStop: NextStop }): ReactElement {
  return (
    <View className="w-full gap-md">
      <View className="w-full px-lg">
        <Text className="font-noto-bold text-section font-bold text-ink">
          가장 먼저 갈 곳
        </Text>
      </View>
      <View
        testID="home-next-stop"
        style={softCardShadow}
        className="mx-lg flex-row items-center gap-md rounded-card border border-hairline bg-canvas px-md py-md"
      >
        <View className="h-[30px] w-[30px] items-center justify-center rounded-pill bg-primary">
          <Text className="font-noto-bold text-caption font-bold text-on-primary">
            {nextStop.order}
          </Text>
        </View>
        <View className="flex-1 gap-[3px]">
          <Text className="font-noto text-micro text-muted">
            {nextStop.time}
          </Text>
          <Text className="font-noto-bold text-body font-bold text-ink">
            {nextStop.title}
          </Text>
          <Text className="font-noto text-micro text-muted">
            {nextStop.placeMeta}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── 미니맵 카드(upcoming '지금 내 주변' · postTrip '회고 보기' 공용 · 브리프 §3-C) ──
// 미니맵은 플레이스홀더(가정 F — shared/map 끌어오지 않음, 홈은 프레젠테이션 순수 유지).
function MiniMapCard({
  testID,
  title,
  subtitle,
}: {
  testID: string;
  title: string;
  subtitle: string;
}): ReactElement {
  return (
    <View
      testID={testID}
      style={softCardShadow}
      className="mx-lg flex-row items-center gap-md overflow-hidden rounded-card border border-hairline bg-canvas px-md py-md"
    >
      <View className="h-[54px] w-[54px] rounded-card bg-surface-soft" />
      <View className="flex-1 gap-[3px]">
        <Text className="font-noto-bold text-body font-bold text-ink">
          {title}
        </Text>
        <Text className="font-noto text-micro text-muted">{subtitle}</Text>
      </View>
    </View>
  );
}

// ── 지난 여행(upcoming·postTrip 공용) ───────────────────────────────────
function PastTripsSection({
  trips,
}: {
  trips: readonly PastTrip[];
}): ReactElement {
  return (
    <View className="w-full gap-md">
      <View className="w-full px-lg">
        <Text className="font-noto-bold text-section font-bold text-ink">
          지난 여행
        </Text>
      </View>
      <View className="mx-lg gap-sm">
        {trips.map((trip, index) => (
          <View
            key={trip.title}
            testID={`home-past-trip-card-${index}`}
            style={softCardShadow}
            className="flex-row items-center gap-md rounded-card border border-hairline bg-canvas px-md py-md"
          >
            <View className="h-[44px] w-[44px] rounded-card bg-surface-strong" />
            <Text className="font-noto-bold text-body font-bold text-ink">
              {trip.title}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── 컬렉션 가로 스트립(collecting '내가 담은 곳' · postTrip '다음엔 여기 어때요') ──
function CollectionStrip({
  title,
  collections,
}: {
  title: string;
  collections: readonly HomeCollectionCard[];
}): ReactElement {
  return (
    <View className="w-full gap-md">
      <SectionHeader title={title} moreTestID="home-collections-more" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      >
        {collections.map((card, index) => (
          <CollectionCard key={card.title} card={card} index={index} />
        ))}
      </ScrollView>
    </View>
  );
}

// ── 담은 곳 N 칩(collecting · FAB 위 · US-SHELL-05 잇기) ─────────────────
function SavedCountChip({ label }: { label: string }): ReactElement {
  return (
    <View
      testID="home-saved-count-chip"
      style={fabShadow}
      className="absolute bottom-[160px] right-lg rounded-pill border-[1.4px] border-primary bg-canvas px-md py-sm"
    >
      <Text className="font-noto-bold text-caption font-bold text-primary-text">
        {label}
      </Text>
    </View>
  );
}

// ── FAB(여행 만들기 · 우하단 floating) ──────────────────────────────────
// bottom 오프셋은 화면 쪽에서 직접 잡는다 — 탭바는 SafeArea/네비 모르는 순수 뷰 계약이라
// bottom inset을 합산하지 않는다(repo-trap). 실제 여백은 [검증] 6-b 실기 스모크에서 눈으로
// 확인한다(자동 심판 없음, 브리프 §8-4).
// 값의 출처는 Figma `a01-home · scrolled`(2105:1615) 실측이다 — 프레임 390×1464 에서
// fabCollapsed(2105:1757)가 x=318·y=1324·56×56 이므로 우측 여백 16(=right-lg) · 바닥에서
// 84(=1464-1380). 탭바 밴드는 96px 이지만 보이는 알약은 pt-[26px] 안쪽에서 시작하므로
// 84 는 그 알약 위 14px 에 뜬다(디자인과 같은 관계). 라벨은 어느 상태에서도 그리지 않고
// 접근성 이름만 `accessibilityLabel`로 남긴다 — 텍스트를 지우면 이름도 같이 사라진다.
// ⚠️ 크기를 `h-14 w-14`로 쓰지 마라 — NativeWind 의 rem 기준이 14px 이라 3.5rem=49px 로
// 렌더된다(실측). Figma px 를 옮길 때는 리포 관례대로 `h-[56px]` 브래킷을 쓴다.
function CreateTripFab({ onPress }: { onPress?: () => void }): ReactElement {
  return (
    <Pressable
      testID="home-create-trip-fab"
      accessibilityRole="button"
      accessibilityLabel="여행 만들기"
      onPress={onPress}
      style={fabShadow}
      className="absolute bottom-[84px] right-lg h-[56px] w-[56px] items-center justify-center rounded-full bg-primary"
    >
      <PlusGlyph size={22} />
    </Pressable>
  );
}

// 담은 곳 saved-menu FAB(TRIP-494 홈 확장 · Figma a01 3012:1731) — + FAB 바로 위 흰 원형 하트.
// 누르면 두 미니 FAB 으로 펼쳐진다: 담은 장소(위치핀→d02) · 저장한 숙소(가방→e04). 열리면
// 하트가 X(닫기, 핑크)로 바뀌고 배후 backdrop 이 뜬다(바깥 탭으로 닫힘). 열림 상태·목적지는
// 라우트가 소유해 prop 으로 내린다(화면 useState 0건 — homeStructure 순수성, 탐색 랜딩과 동형).
function SavedMenuFab({
  open,
  onToggle,
  onPressSavedPlaces,
  onPressSavedStays,
}: {
  open: boolean;
  onToggle?: () => void;
  onPressSavedPlaces?: () => void;
  onPressSavedStays?: () => void;
}): ReactElement {
  return (
    <>
      {open ? (
        <Pressable
          testID="home-saved-menu-backdrop"
          accessibilityRole="button"
          accessibilityLabel="담은 곳 메뉴 닫기"
          onPress={onToggle}
          className="absolute inset-0 bg-scrim/40"
        />
      ) : null}
      <View className="absolute bottom-[152px] right-lg flex-row items-center gap-md">
        {open ? (
          <>
            <Pressable
              testID="home-saved-places-fab"
              accessibilityRole="button"
              accessibilityLabel="담은 장소"
              onPress={onPressSavedPlaces}
              style={fabShadow}
              className="h-[56px] w-[56px] items-center justify-center rounded-full bg-canvas"
            >
              <MapPinGlyph size={26} />
            </Pressable>
            <Pressable
              testID="home-saved-stays-fab"
              accessibilityRole="button"
              accessibilityLabel="저장한 숙소"
              onPress={onPressSavedStays}
              style={fabShadow}
              className="h-[56px] w-[56px] items-center justify-center rounded-full bg-canvas"
            >
              <SuitcaseGlyph size={26} />
            </Pressable>
          </>
        ) : null}
        <Pressable
          testID="home-saved-menu-toggle"
          accessibilityRole="button"
          accessibilityLabel={open ? '담은 곳 메뉴 닫기' : '담은 곳'}
          onPress={onToggle}
          style={fabShadow}
          className={`h-[56px] w-[56px] items-center justify-center rounded-full ${
            open ? 'bg-primary' : 'bg-canvas'
          }`}
        >
          {open ? <CloseGlyph size={24} /> : <HeartFilledGlyph size={26} />}
        </Pressable>
      </View>
    </>
  );
}

// ── discovery 얼굴(316 발견·영감 피드) ──────────────────────────────────
function DiscoveryBody({
  hero,
  sections,
  onPressSpotsMore,
  onPressSearch,
}: {
  hero: HomeMagazineHero;
  sections: HomeSections;
  onPressSpotsMore?: () => void;
  onPressSearch?: () => void;
}): ReactElement {
  return (
    <>
      <GreetingHeader
        title="오늘은 어디를 상상해볼까요"
        subtitle="떠나지 않아도, 구경하고 모으는 즐거움"
      />
      <SearchBarBlock onPress={onPressSearch} />
      <MagazineHero hero={hero} />
      <View className="w-full gap-[24px] pb-sm pt-[22px]">
        <CollectionsSection sections={sections} />
        <SpotsSection sections={sections} onMore={onPressSpotsMore} />
        <ItinerariesSection sections={sections} />
      </View>
    </>
  );
}

// ── collecting 얼굴(담는 중 · discovery와 가장 가까움) ──────────────────
// greet 저장개수 · 섹션1 "내가 담은 곳"(지역 badge+저장일) · softNote 숨김 · 담은 곳 N 칩(오버레이).
function CollectingBody({
  hero,
  sections,
  phase,
  onPressSearch,
}: {
  hero: HomeMagazineHero;
  sections: HomeSections;
  phase: Extract<HomePhase, { kind: 'collecting' }>;
  onPressSearch?: () => void;
}): ReactElement {
  return (
    <>
      <GreetingHeader title={phase.greetTitle} subtitle={phase.greetSubtitle} />
      <SearchBarBlock onPress={onPressSearch} />
      <MagazineHero hero={hero} />
      <View className="w-full gap-[24px] pb-sm pt-[22px]">
        <CollectionStrip
          title={phase.sectionTitle}
          collections={phase.collections}
        />
        <SpotsSection sections={sections} />
        <ItinerariesSection sections={sections} />
      </View>
    </>
  );
}

// ── planning 얼굴(계획 중) ──────────────────────────────────────────────
// greet 여행명+D-day · tripHero(계획 중) · 브릿지행(softNote 슬롯) · magazineHero·grid·lane 숨김.
function PlanningBody({
  phase,
  onPressTripHeroCta,
  onPressSearch,
}: {
  phase: Extract<HomePhase, { kind: 'planning' }>;
  onPressTripHeroCta?: () => void;
  onPressSearch?: () => void;
}): ReactElement {
  return (
    <>
      <GreetingHeader title={phase.greetTitle} />
      <SearchBarBlock onPress={onPressSearch} />
      <TripHero trip={phase.trip} onPress={onPressTripHeroCta} />
    </>
  );
}

// ── upcoming 얼굴(출발 전 활성 여행 허브 · 가장 다른 얼굴) ───────────────
// 이름 greet · tripHero(출발 전) · 스탯 2 · 가장 먼저 갈 곳 · 지금 내 주변 · 지난 여행.
// searchBar·magazineHero·softNote·컬렉션/스팟 전부 없음(브리프 §8-6).
function UpcomingBody({
  phase,
}: {
  phase: Extract<HomePhase, { kind: 'upcoming' }>;
}): ReactElement {
  return (
    <>
      <GreetingHeader name={phase.greetName} title={phase.greetTitle} />
      <TripHero trip={phase.trip} />
      <View className="w-full gap-[24px] pb-sm pt-[22px]">
        <NextStopCard nextStop={phase.nextStop} />
        <MiniMapCard
          testID="home-nearby-card"
          title={phase.nearby.title}
          subtitle={phase.nearby.subtitle}
        />
        <PastTripsSection trips={phase.pastTrips} />
      </View>
    </>
  );
}

// ── postTrip 얼굴(다녀옴) ───────────────────────────────────────────────
// greet 잘 다녀오셨어요 · 회고 보기 카드 · 추천 스트립 · 지난 여행 · 공유행(softNote 슬롯).
function PostTripBody({
  phase,
  onPressSearch,
}: {
  phase: Extract<HomePhase, { kind: 'postTrip' }>;
  onPressSearch?: () => void;
}): ReactElement {
  return (
    <>
      <GreetingHeader title={phase.greetTitle} />
      <SearchBarBlock onPress={onPressSearch} />
      <View className="w-full px-lg pt-[8px]">
        <MiniMapCard
          testID="home-recap-card"
          title={phase.recap.title}
          subtitle={phase.recap.meta}
        />
      </View>
      <View className="w-full gap-[24px] pb-sm pt-[22px]">
        <CollectionStrip
          title={phase.recommendationTitle}
          collections={phase.recommendations}
        />
        <PastTripsSection trips={phase.pastTrips} />
      </View>
    </>
  );
}

// 화면은 phase.kind로 스위치만 한다(단계를 스스로 도출하지 않는다, TRIP-206 S-6).
function PhaseBody({
  hero,
  sections,
  phase,
  onPressSpotsMore,
  onPressTripHeroCta,
  onPressSearch,
}: HomeScreenProps): ReactElement {
  if (phase === undefined || phase.kind === 'discovery') {
    return (
      <DiscoveryBody
        hero={hero}
        sections={sections}
        onPressSpotsMore={onPressSpotsMore}
        onPressSearch={onPressSearch}
      />
    );
  }
  switch (phase.kind) {
    case 'collecting':
      return (
        <CollectingBody
          hero={hero}
          sections={sections}
          phase={phase}
          onPressSearch={onPressSearch}
        />
      );
    case 'planning':
      return (
        <PlanningBody
          phase={phase}
          onPressTripHeroCta={onPressTripHeroCta}
          onPressSearch={onPressSearch}
        />
      );
    case 'upcoming':
      return <UpcomingBody phase={phase} />;
    case 'postTrip':
      return <PostTripBody phase={phase} onPressSearch={onPressSearch} />;
  }
}

export function HomeScreen({
  hero,
  sections,
  phase,
  onPressCreateTrip,
  onPressSavedPlaces,
  onPressSavedStays,
  onPressSpotsMore,
  onPressTripHeroCta,
  onPressSearch,
  savedMenuOpen,
  onToggleSavedMenu,
}: HomeScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="home-dashboard-root" className="flex-1 bg-canvas">
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 140 }}
        >
          <PhaseBody
            hero={hero}
            sections={sections}
            phase={phase}
            onPressSpotsMore={onPressSpotsMore}
            onPressTripHeroCta={onPressTripHeroCta}
            onPressSearch={onPressSearch}
          />
        </ScrollView>
        {phase?.kind === 'collecting' ? (
          <SavedCountChip label={phase.savedChipLabel} />
        ) : null}
        <SavedMenuFab
          open={savedMenuOpen ?? false}
          onToggle={onToggleSavedMenu}
          onPressSavedPlaces={onPressSavedPlaces}
          onPressSavedStays={onPressSavedStays}
        />
        <CreateTripFab onPress={onPressCreateTrip} />
      </View>
    </SafeAreaView>
  );
}
