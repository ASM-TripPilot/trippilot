// 홈 히어로 — 도시 카드(MagazineHero, memo)·통합 트립 히어로와 그것을 페이지로 쓰는 두 캐러셀.
import { memo, useState, type ReactElement } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { HomeSparkleGlyph } from './HomeGlyphs';
import { ABSOLUTE_FILL, SCRIM_LOCATIONS, softCardShadow } from './homeSurface';
import { Image } from '@/shared/ui/Image';
import type { HomeMagazineHero, TripHeroData } from '../model/homeTypes';
import { COLOR_TOKENS } from '@/shared/config';

// 사진 위 흰 글씨 가독성을 위한 스크림 그라디언트(브리프 §3-D 명시 raw 허용 — 스크림은 토큰
// 대상이 아니다). 상단 30%는 투명, 하단은 검정. 카드별 하단 농도만 Figma 실측대로 다르다.
const HERO_SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.8)'] as const;

// 통합 히어로(TRIP-696) 전용 3-stop 스크림(Figma 3460:1836: 0 → 0.3@50% → 0.85). 2-stop
// HERO_SCRIM 보다 중간 톤이 한 단계 더 있어 하단을 짙게 눌러 타이틀26·CTA 가독성을 확보한다.
const INTEGRATED_HERO_SCRIM_LOCATIONS = [0, 0.5, 1] as const;
const INTEGRATED_HERO_SCRIM_COLORS = [
  'rgba(0,0,0,0)',
  'rgba(0,0,0,0.3)',
  'rgba(0,0,0,0.85)',
] as const;

// hero 메타칩 반투명 흰 배경(브리프 §3-C 명시 raw 예외 — 알파는 토큰이 아니다).
const HERO_CHIP_STYLE = { backgroundColor: 'rgba(255,255,255,0.22)' } as const;

// TRIP-891 — 사진/그라디언트 위 흰 도트 저대비 봉합(6-b 실측, Figma 2091:1357). 활성 색
// (bg-on-primary)·비활성(opacity-50) 계약은 불변으로 두고, 도트에 미세 검정 그림자(halo)만
// 얹어 밝은 배경 위에서도 흰 도트가 식별되게 한다. 그림자는 토큰 대상 아님(카드 그림자 관례).
const heroDotShadow = {
  shadowColor: COLOR_TOKENS.scrim,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.45,
  shadowRadius: 2,
  elevation: 2,
} as const;

// ── magazineHero(영감 카드) ─────────────────────────────────────────────
// TRIP-694: 히어로 하트 제거(AC-1) · 생성 사진 Image 배선(AC-5) · discovery/planning 캐러셀
// 페이지로 재사용하기 위한 옵셔널 testID(기본 home-magazine-hero, 캐러셀 슬라이드는 다른 값)·
// showDots(캐러셀 페이지는 false 로 넘겨 도트 1벌을 캐러셀 오버레이가 소유). 사진은 uri 유무와
// 무관하게 Image 를 무조건 렌더한다 — jest 에선 uri 가 null(사진 없는 카드)이지만 Image 엘리먼트
// 자체는 그려져 AC-5 렌더 계약을 만족한다. TRIP-696 이후 두 캐러셀 모두 showDots={false}로 넘겨
// 기본 true(내부 3-dot) 경로는 미소비다 — 리팩토링(5-c) 정리 후보.
// TRIP-1432 — 카드는 서울·부산·제주 도시 카드다. 도시 코드(regionCode)가 있으면 콜백 유무와 무관하게
// 구조로 버튼이고(버튼-집합 테스트는 콜백 없이 렌더), press 는 그 코드로 onPressCity 를 부른다.
// 코드를 붙이는 함수는 memo 안쪽에서 만든다 — 바깥에서 카드마다 새 함수를 넘기면 memo 가 깨진다.
function MagazineHeroImpl({
  hero,
  testID = 'home-magazine-hero',
  showDots = true,
  onPressCity,
  priority = 'low',
}: {
  hero: HomeMagazineHero;
  // TRIP-1363 — 캐러셀 첫 장만 high, 나머지는 low(화면 밖 페이지가 첫 장 디코드를 밀지 않게).
  priority?: 'high' | 'low';
  testID?: string;
  showDots?: boolean;
  onPressCity?: (regionCode: string) => void;
}): ReactElement {
  const rootClassName = 'h-[470px] w-full overflow-hidden';
  const regionCode = hero.regionCode;
  const content = (
    <>
      {/* 그림 자리 — 토큰색 tint 위에 번들 도시 그림(스크림 아래), 그림 없으면 tint 노출 */}
      <View className="absolute inset-0 bg-surface-strong" />
      <Image
        source={hero.coverSource ?? undefined}
        contentFit="cover"
        cachePolicy="memory-disk"
        priority={priority}
        style={ABSOLUTE_FILL}
      />
      <LinearGradient
        colors={HERO_SCRIM_COLORS}
        locations={SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="flex-1 justify-between px-lg pb-[44px] pt-xl">
        {/* 상단: eyebrow pill(하트는 TRIP-694로 제거) */}
        <View className="w-full flex-row items-start justify-between">
          <View className="flex-row items-center gap-[6px] self-start rounded-pill bg-canvas px-md py-[5px]">
            <HomeSparkleGlyph size={13} />
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
  return regionCode !== undefined ? (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={() => onPressCity?.(regionCode)}
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

// TRIP-1349 — 캐러셀 page state 가 바뀔 때마다 풀블리드 슬라이드 5장(Image+LinearGradient)이 재렌더되던 것을
// 막는다. props(hero·testID·onPress…)가 같으면 bail-out, 하나라도 바뀌면 다시 그린다(얕은 비교).
const MagazineHero = memo(MagazineHeroImpl);

// ── discovery 히어로 캐러셀(TRIP-694 페이징 · TRIP-1432 도시 카드 3장) ─────────────
// 히어로 데이터 한 장 = 한 페이지. 페이지 래퍼는 N당 정확히 1노드(home-hero-page-N), page0 안의
// MagazineHero 만 home-magazine-hero(단일성 유지), 도트는 캐러셀이 고정 오버레이 1벌(home-hero-dot-N)로
// 소유한다. 실 스와이프·페이지 전환·활성 도트 하이라이트는 jest 원리적 사각(6-b 실기) — 구조만 잠긴다.
export function DiscoveryHeroCarousel({
  heroes,
  onPressHeroCity,
}: {
  heroes: readonly HomeMagazineHero[];
  onPressHeroCity?: (regionCode: string) => void;
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
              priority={i === 0 ? 'high' : 'low'}
              onPressCity={onPressHeroCity}
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
// 여행 지역 그림이 없으면 tint 그대로 — 도시 카드 그림을 대신 깔지 않는다(TRIP-1432 Q4, 강릉 여행에 서울 그림 금지).
function IntegratedTripHero({
  trip,
  onPress,
}: {
  trip: TripHeroData;
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
        testID="home-trip-hero-cover"
        source={trip.coverSource ?? undefined}
        contentFit="cover"
        cachePolicy="memory-disk"
        priority="high"
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

// ── planning 통합 히어로 캐러셀(TRIP-696 · TRIP-1432 여행 카드 + 도시 카드) ──────────────
// 구 2페이지 HeroCarousel(TripHero 카드 ↔ Magazine·2도트)을 폐기하고 discovery 캐러셀
// (DiscoveryHeroCarousel)과 동형으로 통일한다: page0 = 통합 트립 히어로, page1~ = discovery 와 같은
// 도시 카드(hero 전부, 같은 동작). 페이지 수의 진짜 앵커는 home-hero-page-N 컨테이너다 — 도트는 정적
// View 나열이라 위조 가능(traps-home)하므로 도트 오버레이는 **실제 페이지 수에서 파생**해 1벌만
// 그린다. 매거진 페이지 testID 는 home-hero-slide-N(page0 만 home-trip-hero — home-magazine-hero
// 다중매치 회피, ★D2). 실 스와이프·활성 도트 하이라이트는 jest 원리적 사각(6-b 실기).
export function PlanningHeroCarousel({
  trip,
  heroes,
  onPressTripCta,
  onPressHeroCity,
}: {
  trip: TripHeroData;
  heroes: readonly HomeMagazineHero[];
  onPressTripCta?: () => void;
  onPressHeroCity?: (regionCode: string) => void;
}): ReactElement {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const pageCount = 1 + heroes.length; // page0(트립) + 도시 카드
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
          <IntegratedTripHero trip={trip} onPress={onPressTripCta} />
        </View>
        {heroes.map((hero, i) => (
          <View key={i} testID={`home-hero-page-${i + 1}`} style={{ width }}>
            <MagazineHero
              hero={hero}
              testID={`home-hero-slide-${i + 1}`}
              showDots={false}
              onPressCity={onPressHeroCity}
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
