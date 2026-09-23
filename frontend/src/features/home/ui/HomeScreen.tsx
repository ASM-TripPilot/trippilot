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
import { useState, type ReactElement } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BellGlyph,
  CloseGlyph,
  HeartFilledGlyph,
  LocationPinGlyph,
  MapPinGlyph,
  PlusGlyph,
  SearchGlyph,
  SparkleGlyph,
  SuitcaseGlyph,
} from './HomeGlyphs';
import { formatCountBadge } from '../lib/formatCountBadge';
import type {
  HomeCollectionCard,
  HomeMagazineHero,
  HomePhase,
  HomeScreenProps,
  HomeSections,
  HomeSpotCard,
  PastTrip,
  TripHeroData,
} from '../model/homeTypes';

// 사진 위 흰 글씨 가독성을 위한 스크림 그라디언트(브리프 §3-D 명시 raw 허용 — 스크림은 토큰
// 대상이 아니다). 상단 30%는 투명, 하단은 검정. 카드별 하단 농도만 Figma 실측대로 다르다.
const SCRIM_LOCATIONS = [0.3, 1] as const;
const HERO_SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.8)'] as const;
const DEST_SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)'] as const;
const SPOT_SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.66)'] as const;
// postTrip 가로 사진 카드 스크림(Figma 2092:1521). 색은 DEST_SCRIM 재사용, 시작 위치만
// 0.3→0.4 로 늦춰(작은 카드라 글씨 영역이 아래 1/3) 하단만 짙게 눌러 흰 타이틀 가독성 확보.
const PAST_TRIP_SCRIM_LOCATIONS = [0.4, 1] as const;

// 통합 히어로(TRIP-696) 전용 3-stop 스크림(Figma 3460:1836: 0 → 0.3@50% → 0.85). 2-stop
// HERO_SCRIM 보다 중간 톤이 한 단계 더 있어 하단을 짙게 눌러 타이틀26·CTA 가독성을 확보한다.
const INTEGRATED_HERO_SCRIM_LOCATIONS = [0, 0.5, 1] as const;
const INTEGRATED_HERO_SCRIM_COLORS = [
  'rgba(0,0,0,0)',
  'rgba(0,0,0,0.3)',
  'rgba(0,0,0,0.85)',
] as const;

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

// TRIP-891 — 사진/그라디언트 위 흰 도트 저대비 봉합(6-b 실측, Figma 2091:1357). 활성 색
// (bg-on-primary)·비활성(opacity-50) 계약은 불변으로 두고, 도트에 미세 검정 그림자(halo)만
// 얹어 밝은 배경 위에서도 흰 도트가 식별되게 한다. 그림자는 토큰 대상 아님(카드 그림자 관례).
const heroDotShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.45,
  shadowRadius: 2,
  elevation: 2,
} as const;

// ── 인사 헤더 ───────────────────────────────────────────────────────────
// discovery는 고정 카피, 단계 얼굴은 greetTitle/greetSubtitle/greetName을 주입받는다.
// TRIP-939 AC-9 — 종은 알림함 진입 버튼이다. role 은 콜백 유무가 아니라 구조로 굳힌다(370-AC-4 집합).
// 하드코딩 빨간점은 뺐다(Q3 — 읽음 처리 미배선이라 켜지면 꺼지지 않는다).
function GreetingHeader({
  title,
  subtitle,
  name,
  onPressBell,
}: {
  title: string;
  subtitle?: string;
  name?: string;
  onPressBell?: () => void;
}): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-sm px-lg pb-[10px] pt-lg">
      <View testID="home-greeting" className="flex-1 gap-px">
        {name ? (
          <Text className="font-noto text-[13.5px] text-muted">{name}</Text>
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
        accessibilityRole="button"
        onPress={onPressBell}
        style={softCardShadow}
        className="h-[40px] w-[40px] items-center justify-center rounded-full bg-canvas"
      >
        <BellGlyph size={22} />
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
// TRIP-694: 히어로 하트 제거(AC-1) · 생성 사진 Image 배선(AC-5) · discovery/planning 캐러셀
// 페이지로 재사용하기 위한 옵셔널 testID(기본 home-magazine-hero, 캐러셀 슬라이드는 다른 값)·
// showDots(캐러셀 페이지는 false 로 넘겨 도트 1벌을 캐러셀 오버레이가 소유). 사진은 uri 유무와
// 무관하게 Image 를 무조건 렌더한다 — jest 에선 uri 가 null(사진 없는 카드)이지만 Image 엘리먼트
// 자체는 그려져 AC-5 렌더 계약을 만족한다. TRIP-696 이후 두 캐러셀 모두 showDots={false}로 넘겨
// 기본 true(내부 3-dot) 경로는 미소비다 — 리팩토링(5-c) 정리 후보.
function MagazineHero({
  hero,
  testID = 'home-magazine-hero',
  showDots = true,
  asButton = false,
  onPress,
}: {
  hero: HomeMagazineHero;
  testID?: string;
  showDots?: boolean;
  // TRIP-700 — discovery 캐러셀 page0 만 a02 매거진 목록으로 가는 배선 CTA. TRIP-935 R1 — 운영
  // 라우트가 콜백을 안 넘겨 진입을 막으므로, page0 도 onPressMagazine 이 있을 때만 asButton 이다.
  // page1~4 슬라이드·planning/postTrip 슬라이드는 asButton 기본 false 라 비버튼 유지(집합 초과 방지).
  asButton?: boolean;
  onPress?: () => void;
}): ReactElement {
  const rootClassName = 'h-[470px] w-full overflow-hidden';
  const content = (
    <>
      {/* 사진 자리 — 토큰색 tint 위에 생성 사진(스크림 아래), uri 없으면 tint 노출 */}
      <View className="absolute inset-0 bg-surface-strong" />
      <Image
        source={hero.imageUrl ? { uri: hero.imageUrl } : undefined}
        resizeMode="cover"
        style={ABSOLUTE_FILL}
      />
      <LinearGradient
        colors={HERO_SCRIM_COLORS}
        locations={SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="flex-1 justify-between px-lg pb-xl pt-xl">
        {/* 상단: eyebrow pill(하트는 TRIP-694로 제거) */}
        <View className="w-full flex-row items-start justify-between">
          <View className="flex-row items-center gap-[6px] self-start rounded-pill bg-canvas px-md py-[5px]">
            <SparkleGlyph size={13} />
            <Text className="font-noto-bold text-[11.5px] font-bold text-ink">
              {hero.eyebrow}
            </Text>
          </View>
        </View>
        {/* 하단: 타이틀 + 부제 + 메타칩 + (planning 전용) 3-dot */}
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
          {showDots ? (
            <View className="flex-row items-center gap-[5px] pt-[4px]">
              <View className="h-[6px] w-[18px] rounded-pill bg-on-primary" />
              <View className="h-[6px] w-[6px] rounded-pill bg-on-primary opacity-50" />
              <View className="h-[6px] w-[6px] rounded-pill bg-on-primary opacity-50" />
            </View>
          ) : null}
        </View>
      </View>
    </>
  );
  return asButton ? (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className={rootClassName}
    >
      {content}
    </Pressable>
  ) : (
    <View testID={testID} className={rootClassName}>
      {content}
    </View>
  );
}

// ── discovery 히어로 캐러셀(TRIP-694 · 5페이지 페이징) ─────────────────────
// discovery 얼굴의 단일 MagazineHero 를 5장 페이징 캐러셀로 바꾼다. 페이지 래퍼는 N당 정확히
// 1노드(home-hero-page-N), page0 안의 MagazineHero 만 home-magazine-hero(단일성 유지), 도트는
// 캐러셀이 고정 오버레이 1벌(home-hero-dot-N)로 소유한다. 실 스와이프·페이지 전환·활성 도트
// 하이라이트는 jest 원리적 사각(6-b 실기) — 구조(페이지 5·도트 5)만 잠긴다.
function DiscoveryHeroCarousel({
  heroes,
  onPressMagazine,
}: {
  heroes: readonly HomeMagazineHero[];
  onPressMagazine?: () => void;
}): ReactElement {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  return (
    <View className="w-full">
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) =>
          setPage(Math.round(e.nativeEvent.contentOffset.x / width))
        }
      >
        {heroes.map((hero, i) => (
          <View key={i} testID={`home-hero-page-${i}`} style={{ width }}>
            <MagazineHero
              hero={hero}
              testID={i === 0 ? 'home-magazine-hero' : `home-hero-slide-${i}`}
              showDots={false}
              asButton={i === 0 && onPressMagazine !== undefined}
              onPress={i === 0 ? onPressMagazine : undefined}
            />
          </View>
        ))}
      </ScrollView>
      {/* 도트 오버레이 — 사진 위라 흰색(활성 full·비활성 50%), 6×6 균등 원. 좌하단.
          TRIP-891: 저대비 봉합 위해 heroDotShadow(검정 halo)만 얹음 — 색 계약 불변. */}
      <View className="absolute bottom-[24px] left-lg flex-row items-center gap-[5px]">
        {heroes.map((_, i) => (
          <View
            key={i}
            testID={`home-hero-dot-${i}`}
            style={heroDotShadow}
            className={`h-[6px] w-[6px] rounded-full bg-on-primary ${
              page === i ? '' : 'opacity-50'
            }`}
          />
        ))}
      </View>
    </View>
  );
}

// ── 공용 섹션 헤더(타이틀 + '더 보기') ──────────────────────────────────
// asButton은 role(버튼으로 읽히는가)을, onMore는 press 핸들러를 각각 정한다 — 둘은 함께
// 움직이지 않는다: 배선 인스턴스(뜨는 장소)는 콜백이 안 넘어온 단위 테스트에서도 버튼이어야
// 하므로(370-AC-4) role은 콜백 유무가 아니라 구조로 굳힌다. 비배선 인스턴스(asButton 없음 = 컬렉션)는
// '더 보기' 자체를 그리지 않는다(TRIP-939 B-5 — 목적지가 생기면 asButton+onMore 로 되살린다).
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
      {asButton ? (
        <Pressable
          testID={moreTestID}
          accessibilityRole="button"
          onPress={onMore}
        >
          <Text className="font-noto-bold text-[12.5px] font-bold text-muted underline">
            더 보기
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── 컬렉션 카드(요즘 사람들이 담는 곳 · 내가 담은 곳 · 추천) ─────────────
// 하단 메타는 지역+핀으로 그린다(discovery·추천 공용).
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
      <Image
        source={card.imageUrl ? { uri: card.imageUrl } : undefined}
        resizeMode="cover"
        style={ABSOLUTE_FILL}
      />
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
      <Image
        source={card.imageUrl ? { uri: card.imageUrl } : undefined}
        resizeMode="cover"
        style={ABSOLUTE_FILL}
      />
      <LinearGradient
        colors={SPOT_SCRIM_COLORS}
        locations={SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
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

// ── 섹션1: 요즘 사람들이 담는 곳(가로 스크롤 · 3상태) ───────────────────
function CollectionsSection({
  sections,
  title = '요즘 사람들이 담는 곳',
}: {
  sections: HomeSections;
  /** 컬렉션 헤더 카피. 미지정이면 기본 "요즘 사람들이 담는 곳"(discovery), planning 은 지역
   *  카피("부산에서 담을 만한 곳")를 주입(TRIP-696 파라미터화 — 기본값 문자열은 homeStructure
   *  긍정 앵커라 소스에 남는다). */
  title?: string;
}): ReactElement {
  return (
    <View className="w-full gap-md">
      <SectionHeader title={title} moreTestID="home-collections-more" />
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

// ── 통합 트립 히어로(planning·postTrip page0 · TRIP-696 풀블리드 재작성 · Figma 3460:1836) ──
// 구 300px 카드(TripHero)를 470 풀블리드로 교체. 사진 + 3-stop 스크림 위에 좌상단 배지와
// 하단 heroStack(타이틀26·메타14 위 → primary CTA 아래)을 얹는다.
//  - 배지 주 텍스트 색은 badgeTone(TRIP-698)으로 갈린다: 미지정 primary(계획·여행 중) · 'success'
//    초록(여행 완료). 보조(badgeSub)는 있을 때만 별개 <Text> 리프로 그린다 — 계획/여행 중은 두 톤
//    ("계획 중"+"· D-21"), 여행 완료는 단일("여행 완료"만). within(badge).getByText 완전일치가 잠근다.
//  - 구 우상단 대형 D-day(home-trip-hero-dday)는 배지 보조(badgeSub)로 흡수돼 사라졌다(AC-696-2).
//  - CTA 라벨(꺾쇠 › 포함)은 데이터 그대로 렌더한다 — 꺾쇠는 화면이 붙이지 않는다(구 카드는 CTA
//    가 위였으나 순서 반전, 타이틀·메타 아래로 내려왔다).
// 카드 본체(home-trip-hero)와 알약(home-trip-hero-cta)이 같은 onPress 를 공유하고 둘 다
// role="button"(콜백 미주입 렌더의 버튼-집합 테스트가 구조적 role 을 요구, ★D4). 중첩 Pressable 이라
// 알약 press 는 알약에서 멈춘다.
function IntegratedTripHero({
  trip,
  imageUrl,
  onPress,
}: {
  trip: TripHeroData;
  imageUrl?: string | null;
  onPress?: () => void;
}): ReactElement {
  return (
    <Pressable
      testID="home-trip-hero"
      accessibilityRole="button"
      onPress={onPress}
      className="h-[470px] w-full overflow-hidden"
    >
      <View className="absolute inset-0 bg-surface-strong" />
      <Image
        source={imageUrl ? { uri: imageUrl } : undefined}
        resizeMode="cover"
        style={ABSOLUTE_FILL}
      />
      <LinearGradient
        colors={INTEGRATED_HERO_SCRIM_COLORS}
        locations={INTEGRATED_HERO_SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="flex-1 justify-between px-lg pb-[44px] pt-lg">
        {/* 좌상단 두 톤 배지 — 흰 pill(테두리 없음), 주(계획 중·primary) + 보조(· D-21·ink). */}
        <View className="w-full flex-row items-start">
          <View
            testID="home-trip-hero-badge"
            style={softCardShadow}
            className="flex-row items-center gap-[4px] self-start rounded-[8px] bg-canvas px-[12px] py-[6px]"
          >
            <Text
              className={`font-noto-bold text-[12px] font-bold ${
                trip.badgeTone === 'success' ? 'text-success' : 'text-primary'
              }`}
            >
              {trip.badge}
            </Text>
            {trip.badgeSub ? (
              <Text className="font-noto-bold text-[12px] font-bold text-ink">
                {trip.badgeSub}
              </Text>
            ) : null}
          </View>
        </View>
        {/* 하단 heroStack — 타이틀26·메타14 위, primary CTA(꺾쇠 포함) 아래. */}
        <View className="w-full gap-[14px]">
          <View className="gap-[6px]">
            <Text className="font-noto-bold text-[26px] font-bold text-on-primary">
              {trip.title}
            </Text>
            <Text className="font-noto text-[14px] text-on-primary opacity-90">
              {trip.meta}
            </Text>
          </View>
          <Pressable
            testID="home-trip-hero-cta"
            accessibilityRole="button"
            onPress={onPress}
            className="self-start rounded-[12px] bg-primary px-[16px] py-[10px]"
          >
            <Text className="font-noto-bold text-[14px] font-bold text-on-primary">
              {trip.ctaLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

// ── 지난 여행 가로 사진 카드(postTrip · Figma 2092:1521) ──────────────────
// 158×120 rounded-12 사진 카드 — object-cover 사진(uri null 이면 토큰 tint) 위 하단 스크림,
// 흰 타이틀14 + 둘째줄 dateLabel10.5(opacity 88). CollectionCard 와 같은 "사진+스크림+흰 글씨"
// 계열이나 치수·둘째줄이 달라 별 함수로 둔다(HOME_SCREEN_SOURCE_FILES 동결 — 파일 내부 함수).
function PastTripCard({
  trip,
  index,
}: {
  trip: PastTrip;
  index: number;
}): ReactElement {
  return (
    <View
      testID={`home-past-trip-card-${index}`}
      style={softCardShadow}
      className="h-[120px] w-[158px] overflow-hidden rounded-[12px]"
    >
      <View className="absolute inset-0 bg-surface-strong" />
      <Image
        source={trip.imageUrl ? { uri: trip.imageUrl } : undefined}
        resizeMode="cover"
        style={ABSOLUTE_FILL}
      />
      <LinearGradient
        colors={DEST_SCRIM_COLORS}
        locations={PAST_TRIP_SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="absolute inset-x-0 bottom-[14px] gap-[2px] px-[12px]">
        <Text className="font-noto-bold text-[14px] font-bold text-on-primary">
          {trip.title}
        </Text>
        <Text className="font-noto text-[10.5px] text-on-primary opacity-[0.88]">
          {trip.dateLabel}
        </Text>
      </View>
    </View>
  );
}

// ── 지난 여행 섹션(postTrip · 가로 스크롤 사진 카드) ─────────────────────
// 헤더 "지난 여행"16 + "전체 보기"(라이브 미도달 no-op) · 가로 스크롤 사진 카드.
function PastTripsSection({
  trips,
}: {
  trips: readonly PastTrip[];
}): ReactElement {
  return (
    <View className="w-full gap-md">
      <View className="w-full flex-row items-center justify-between px-lg">
        <Text className="font-noto-bold text-[16px] font-bold text-ink">
          지난 여행
        </Text>
        <Pressable testID="home-past-trips-more">
          <Text className="font-noto-bold text-label font-bold text-muted underline">
            전체 보기
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      >
        {trips.map((trip, index) => (
          <PastTripCard key={trip.title} trip={trip} index={index} />
        ))}
      </ScrollView>
    </View>
  );
}

// ── 컬렉션 가로 스트립(postTrip '다음엔 여기 어때요') ──────────────────────
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

// 미니 FAB 우상단 개수 배지(핑크 원, TRIP-695) — count≥1 일 때만 그린다(0/미지정/음수→null,
// 빈 원 방지). 텍스트는 formatCountBadge 가 100↑을 '99+'로 접는다(AC-2). 배지 색(bg-primary)은
// View className 이라 jest 관측되지만(미니 FAB 안 SVG 글리프 색과 다름), 지름 20·흰 2px 테두리·
// 우상단 flush 위치는 6-b 육안 전용(jest 사각). `h-[20px]` 브래킷 — `h-5` 는 rem 17.5px 함정.
function CountBadge({
  testID,
  count,
}: {
  testID: string;
  count?: number;
}): ReactElement | null {
  if ((count ?? 0) < 1) return null;
  const label = formatCountBadge(count ?? 0);
  // TRIP-890 — 1~2자리(1~99)는 정원 20px 그대로, 3자리('99+')만 내용 맞춤 알약으로 가로 확장
  // (고정 20px 원에 '+'가 눌리던 6-b 실측 봉합, Figma 3594:1976). 높이·라운드는 불변.
  const wide = label.length >= 3;
  return (
    <View
      testID={testID}
      className={`absolute right-0 top-0 h-[20px] items-center justify-center rounded-full border-2 border-canvas bg-primary ${
        wide ? 'min-w-[20px] px-[5px]' : 'w-[20px]'
      }`}
    >
      <Text className="text-[12px] font-bold text-on-primary">{label}</Text>
    </View>
  );
}

// 담은 곳 saved-menu FAB(TRIP-494 홈 확장 · Figma a01 3012:1731) — + FAB 바로 위 흰 원형 하트.
// 누르면 두 미니 FAB 으로 펼쳐진다: 담은 장소(위치핀→d02) · 저장한 숙소(가방→e04). 열리면
// 하트가 X(닫기, 핑크)로 바뀐다. 각 미니 FAB 우상단엔 담긴 개수 배지(count≥1일 때만, TRIP-695).
// 배후 backdrop 은 HomeScreen 레벨로 올라갔다(+ FAB 도 덮게, AC-3 z-order). 열림 상태·개수·목적지는
// 라우트가 소유해 prop 으로 내린다(화면 useState 0건 — homeStructure 순수성, 탐색 랜딩과 동형).
function SavedMenuFab({
  open,
  onToggle,
  onPressSavedPlaces,
  onPressSavedStays,
  savedPlacesCount,
  savedStaysCount,
}: {
  open: boolean;
  onToggle?: () => void;
  onPressSavedPlaces?: () => void;
  onPressSavedStays?: () => void;
  savedPlacesCount?: number;
  savedStaysCount?: number;
}): ReactElement {
  return (
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
            <CountBadge
              testID="home-saved-places-badge"
              count={savedPlacesCount}
            />
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
            <CountBadge
              testID="home-saved-stays-badge"
              count={savedStaysCount}
            />
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
  );
}

// ── discovery 얼굴(316 발견·영감 피드) ──────────────────────────────────
function DiscoveryBody({
  hero,
  sections,
  onPressSpotsMore,
  onPressSearch,
  onPressMagazine,
  onPressBell,
}: {
  hero: readonly HomeMagazineHero[];
  sections: HomeSections;
  onPressSpotsMore?: () => void;
  onPressSearch?: () => void;
  onPressMagazine?: () => void;
  onPressBell?: () => void;
}): ReactElement {
  return (
    <>
      <GreetingHeader
        title="오늘은 어디를 상상해볼까요"
        subtitle="떠나지 않아도, 구경하고 모으는 즐거움"
        onPressBell={onPressBell}
      />
      <SearchBarBlock onPress={onPressSearch} />
      {/* TRIP-699 — 로딩이면 히어로는 캐러셀이 아니라 통짜 스켈레톤(390×470, Figma 2174:2307). */}
      {sections.kind === 'loading' ? (
        <View
          testID="home-hero-skeleton"
          className="h-[470px] w-full bg-surface-strong"
        />
      ) : (
        <DiscoveryHeroCarousel
          heroes={hero}
          onPressMagazine={onPressMagazine}
        />
      )}
      <View className="w-full gap-[24px] pb-sm pt-[22px]">
        <CollectionsSection sections={sections} />
        <SpotsSection sections={sections} onMore={onPressSpotsMore} />
      </View>
    </>
  );
}

// ── planning 통합 히어로 캐러셀(TRIP-696 · 5페이지) ──────────────────────────
// 구 2페이지 HeroCarousel(TripHero 카드 ↔ Magazine·2도트)을 폐기하고 discovery 캐러셀
// (DiscoveryHeroCarousel)과 동형 5페이지로 통일한다: page0 = 통합 트립 히어로, page1~4 = 매거진
// 히어로 4장(hero[0..3]). 페이지 수의 진짜 앵커는 home-hero-page-N 컨테이너다 — 도트는 정적
// View 나열이라 위조 가능(traps-home)하므로 도트 오버레이는 **실제 페이지 수에서 파생**해 1벌만
// 그린다. 매거진 페이지 testID 는 home-hero-slide-N(page0 만 home-trip-hero — home-magazine-hero
// 다중매치 회피, ★D2). 실 스와이프·활성 도트 하이라이트는 jest 원리적 사각(6-b 실기).
function PlanningHeroCarousel({
  trip,
  heroes,
  onPressTripCta,
}: {
  trip: TripHeroData;
  heroes: readonly HomeMagazineHero[];
  onPressTripCta?: () => void;
}): ReactElement {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const magazineSlides = heroes.slice(0, 4); // page1~4 = hero[0..3]
  const pageCount = 1 + magazineSlides.length; // page0(트립) + 매거진 4 = 5
  return (
    <View className="w-full">
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) =>
          setPage(Math.round(e.nativeEvent.contentOffset.x / width))
        }
      >
        <View testID="home-hero-page-0" style={{ width }}>
          <IntegratedTripHero
            trip={trip}
            imageUrl={heroes[0]?.imageUrl}
            onPress={onPressTripCta}
          />
        </View>
        {magazineSlides.map((hero, i) => (
          <View key={i} testID={`home-hero-page-${i + 1}`} style={{ width }}>
            <MagazineHero
              hero={hero}
              testID={`home-hero-slide-${i + 1}`}
              showDots={false}
            />
          </View>
        ))}
      </ScrollView>
      {/* 도트 오버레이 — 실제 페이지 수에서 파생(정적 위조 방지). 사진 위라 흰색(활성 full·비활성 50%). */}
      <View className="absolute bottom-[24px] left-lg flex-row items-center gap-[5px]">
        {Array.from({ length: pageCount }, (_, i) => (
          <View
            key={i}
            testID={`home-hero-dot-${i}`}
            className={`h-[6px] w-[6px] rounded-full bg-on-primary ${
              page === i ? '' : 'opacity-50'
            }`}
          />
        ))}
      </View>
    </View>
  );
}

// ── planning 얼굴(계획 중 · 여행 중 · TRIP-696 풀블리드 통합 히어로 재작성) ────────────────
// 인사 2~3줄(이름? + 타이틀 + 서브?) · 통합 히어로 5페이지 캐러셀(page0 트립·page1~4 매거진) ·
// 본문은 컬렉션 1섹션(계획 중), phase.showSpots 면 "지금 뜨는 장소"까지 2섹션(TRIP-697 여행 중).
// SpotsSection 정의는 discovery 도 써서 공유한다. 인사 이름줄(greetName)은 여행 중 픽스처 전용
// (라이브 resolveHomePhase 는 이름 소스가 없어 미주입 → 이름줄 없이 타이틀만, 맹점③).
function PlanningBody({
  phase,
  hero,
  sections,
  onPressSpotsMore,
  onPressTripHeroCta,
  onPressSearch,
  onPressBell,
}: {
  phase: Extract<HomePhase, { kind: 'planning' }>;
  hero: readonly HomeMagazineHero[];
  sections: HomeSections;
  onPressSpotsMore?: () => void;
  onPressTripHeroCta?: () => void;
  onPressSearch?: () => void;
  onPressBell?: () => void;
}): ReactElement {
  return (
    <>
      <GreetingHeader
        title={phase.greetTitle}
        subtitle={phase.greetSubtitle}
        name={phase.greetName}
        onPressBell={onPressBell}
      />
      <SearchBarBlock onPress={onPressSearch} />
      <PlanningHeroCarousel
        trip={phase.trip}
        heroes={hero}
        onPressTripCta={onPressTripHeroCta}
      />
      <View className="w-full gap-[24px] pb-sm pt-[22px]">
        <CollectionsSection
          sections={sections}
          title={phase.collectionsTitle}
        />
        {phase.showSpots ? (
          <SpotsSection sections={sections} onMore={onPressSpotsMore} />
        ) : null}
      </View>
    </>
  );
}

// ── postTrip 얼굴(다녀옴 · TRIP-698 통합 히어로 재작성) ───────────────────
// 인사 2줄(잘 다녀오셨어요 + 서브) · 통합 히어로 5페이지 캐러셀(page0 트립="여행 완료"·page1~4
// 매거진, 도트5 — planning 과 부품 공유) · 섹션 순서 반전(지난 여행 가로 사진 카드 → "다음엔 여기
// 어때요" 추천 스트립). 구 회색 회고 카드(MiniMapCard)·공유행은 제거됐다(01b). 회고 CTA 콜백은
// onPressTripHeroCta 재사용(라이브 미도달이라 프리뷰에선 undefined).
function PostTripBody({
  phase,
  hero,
  onPressTripHeroCta,
  onPressSearch,
  onPressBell,
}: {
  phase: Extract<HomePhase, { kind: 'postTrip' }>;
  hero: readonly HomeMagazineHero[];
  onPressTripHeroCta?: () => void;
  onPressSearch?: () => void;
  onPressBell?: () => void;
}): ReactElement {
  return (
    <>
      <GreetingHeader
        title={phase.greetTitle}
        subtitle={phase.greetSubtitle}
        onPressBell={onPressBell}
      />
      <SearchBarBlock onPress={onPressSearch} />
      <PlanningHeroCarousel
        trip={phase.trip}
        heroes={hero}
        onPressTripCta={onPressTripHeroCta}
      />
      <View className="w-full gap-[24px] pb-sm pt-[22px]">
        <PastTripsSection trips={phase.pastTrips} />
        <CollectionStrip
          title={phase.recommendationTitle}
          collections={phase.recommendations}
        />
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
  onPressMagazine,
  onPressBell,
}: HomeScreenProps): ReactElement {
  if (phase === undefined || phase.kind === 'discovery') {
    return (
      <DiscoveryBody
        hero={hero}
        sections={sections}
        onPressSpotsMore={onPressSpotsMore}
        onPressSearch={onPressSearch}
        onPressMagazine={onPressMagazine}
        onPressBell={onPressBell}
      />
    );
  }
  switch (phase.kind) {
    case 'planning':
      return (
        <PlanningBody
          phase={phase}
          hero={hero}
          sections={sections}
          onPressSpotsMore={onPressSpotsMore}
          onPressTripHeroCta={onPressTripHeroCta}
          onPressSearch={onPressSearch}
          onPressBell={onPressBell}
        />
      );
    case 'postTrip':
      return (
        <PostTripBody
          phase={phase}
          hero={hero}
          onPressTripHeroCta={onPressTripHeroCta}
          onPressSearch={onPressSearch}
          onPressBell={onPressBell}
        />
      );
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
  onPressMagazine,
  onPressBell,
  savedPlacesCount,
  savedStaysCount,
  savedMenuOpen,
  onToggleSavedMenu,
}: HomeScreenProps): ReactElement {
  const menuOpen = savedMenuOpen ?? false;
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
            onPressMagazine={onPressMagazine}
            onPressBell={onPressBell}
          />
        </ScrollView>
        {/* TRIP-699 — 로딩이면 두 FAB 숨김(Figma 2174:2307). 로딩은 항상 discovery라 phase 없음. */}
        {sections.kind !== 'loading' ? (
          <>
            {/* TRIP-695 z-order(AC-3) — 문서순=스택이라(RN 기본, zIndex 없음) 뒤→위로
                CreateTripFab → 백드롭 → 미니 FAB+토글. 백드롭을 + FAB 뒤에 둬 딤이 + FAB 도
                덮는다. 실제 딤 커버는 6-b 육안(jest 원리적 사각). */}
            <CreateTripFab onPress={onPressCreateTrip} />
            {menuOpen ? (
              <Pressable
                testID="home-saved-menu-backdrop"
                accessibilityRole="button"
                accessibilityLabel="담은 곳 메뉴 닫기"
                onPress={onToggleSavedMenu}
                className="absolute inset-0 bg-scrim/40"
              />
            ) : null}
            <SavedMenuFab
              open={menuOpen}
              onToggle={onToggleSavedMenu}
              onPressSavedPlaces={onPressSavedPlaces}
              onPressSavedStays={onPressSavedStays}
              savedPlacesCount={savedPlacesCount}
              savedStaysCount={savedStaysCount}
            />
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
