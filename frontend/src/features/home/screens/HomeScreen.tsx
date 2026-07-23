/**
 * a01-home 프레젠테이션 화면 (TRIP-170 · Figma 1632:1108 정합, 4상태).
 * props만 받는다 — 네트워크·라우팅을 전혀 모른다(브리프 §6-1, homeStructure D-1이 기계 강제).
 * CTA는 전부 no-op(Q3) — onPress 미배선, accessibilityRole="button"만 유지한다.
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BellGlyph,
  ChevronRightGlyph,
  ClockGlyph,
  CommentGlyph,
  FlameGlyph,
  HeartOutlineGlyph,
  LikeHeartGlyph,
  PencilGlyph,
  PlusGlyph,
  RouteDotsGlyph,
} from '../components/HomeGlyphs';
import type {
  HomeNextPlan,
  HomePopularPlace,
  HomeResume,
  HomeScreenProps,
  HomeSections,
  HomeTasteBlock,
  HomeTripHero,
} from '../model/homeTypes';

// 카드 그림자 2종(브리프 §3-D 명시 raw 허용 — 그림자는 토큰 대상이 아니다). RN은 box-shadow가
// 없어 shadow-* 스타일 프로퍼티로 옮긴다.
const heroCardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 4,
} as const;

const softCardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

// hero 사진 스크림 그라디언트(브리프 §3-D 명시 raw 허용) — 상단 30%는 투명, 하단은 흑 72%.
const SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)'] as const;
const SCRIM_LOCATIONS = [0.3, 1] as const;

// ── 공용 섹션 헤더 ──────────────────────────────────────────────────────
// showMore=false인 경우(empty·loading)엔 '더보기 ›'를 아예 그리지 않는다. 취향 블록(내 취향
// 여행지)도 Figma엔 '더보기 ›'가 있어(1632:1258) 인기·취향·커뮤니티 3군데 모두 showMore를
// 켠다(HomeScreen.test.tsx A-1c 총합 3 — 게이트①-2 후속, 03 §8-1).
function SectionHeader({
  title,
  showMore,
  moreTestID,
}: {
  title: string;
  showMore: boolean;
  moreTestID?: string;
}): ReactElement {
  return (
    <View className="w-full flex-row items-center justify-between">
      <Text className="font-noto-bold text-[16px] font-bold text-ink">
        {title}
      </Text>
      {showMore ? (
        <Pressable
          testID={moreTestID}
          accessibilityRole="button"
          onPress={undefined}
        >
          <Text className="font-noto text-label text-muted">더보기 ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── 크롬(상단바) ────────────────────────────────────────────────────────
function TopBar(): ReactElement {
  return (
    <View className="w-full flex-row items-center justify-between px-lg pb-sm pt-sm">
      <Text className="font-inter-bold text-hero font-bold tracking-[-0.44px] text-ink">
        TripPilot
      </Text>
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

// ── hero(여행 카드) ─────────────────────────────────────────────────────
function HeroCard({ trip }: { trip: HomeTripHero }): ReactElement {
  return (
    <View
      testID="home-dashboard-hero"
      style={heroCardShadow}
      className="w-full overflow-hidden rounded-card border border-hairline bg-canvas"
    >
      <View className="h-[150px] w-full overflow-hidden">
        {/* 사진 자리 — 실 사진 소스 없음(브리프 §6) → 토큰 색 플레이스홀더 */}
        <View className="absolute inset-0 bg-surface-strong" />
        <LinearGradient
          colors={SCRIM_COLORS}
          locations={SCRIM_LOCATIONS}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        {trip.overlay ? (
          <>
            <View className="absolute left-[16px] top-[16px] rounded-pill bg-canvas px-md py-[6px]">
              <Text className="font-inter-bold text-card-title font-bold text-primary-text">
                {trip.overlay.dday}
              </Text>
            </View>
            <Text className="absolute right-[16px] top-[22px] font-noto-bold text-label font-bold text-on-primary">
              {trip.overlay.nights}
            </Text>
            <Text className="absolute bottom-[16px] left-[16px] font-noto-bold text-hero font-bold text-on-primary">
              {trip.overlay.title}
            </Text>
          </>
        ) : null}
      </View>
      <View className="w-full gap-[13px] px-lg pb-lg pt-[14px]">
        <Text className="font-noto text-label text-muted">{trip.meta}</Text>
        <View
          testID="home-dashboard-hero-progress"
          className="h-[6px] w-full overflow-hidden rounded-pill bg-surface-strong"
        >
          <View
            style={{ width: `${trip.progressRatio * 100}%` }}
            className="h-full rounded-pill bg-primary"
          />
        </View>
        <Pressable
          testID="home-dashboard-hero-cta"
          accessibilityRole="button"
          onPress={undefined}
          className="h-12 w-full items-center justify-center rounded-button bg-primary"
        >
          <Text className="font-noto-bold text-card-title font-bold text-on-primary">
            일정 보기
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── 첫 사용자 대시 빈 카드 ──────────────────────────────────────────────
function EmptyHeroCard(): ReactElement {
  return (
    <View
      testID="home-dashboard-empty-hero"
      className="w-full items-center gap-md rounded-card border-[1.5px] border-dashed border-hairline-strong bg-canvas px-lg py-[30px]"
    >
      <View className="h-14 w-14 items-center justify-center rounded-pill bg-surface-strong">
        <PlusGlyph size={26} tone="muted" />
      </View>
      <Text className="text-center font-noto-bold text-[16px] font-bold text-ink">
        아직 만든 여행이 없어요
      </Text>
      <Text className="text-center font-noto text-label text-muted">
        가고 싶은 곳을 저장해 두면 여행 만들 때 &apos;꼭 갈 곳&apos;으로 담겨요
      </Text>
      <Pressable
        testID="home-dashboard-empty-cta"
        accessibilityRole="button"
        onPress={undefined}
        className="items-center justify-center rounded-button bg-primary px-2xl py-[13px]"
      >
        <Text className="font-noto-bold text-card-title font-bold text-on-primary">
          여행 만들기
        </Text>
      </Pressable>
    </View>
  );
}

// ── 다음 일정 카드 ──────────────────────────────────────────────────────
function NextPlanCard({ nextPlan }: { nextPlan: HomeNextPlan }): ReactElement {
  return (
    <View
      testID="home-dashboard-next-plan"
      style={softCardShadow}
      className="w-full gap-[11px] rounded-card border border-hairline bg-canvas p-[14px]"
    >
      <View className="w-full flex-row items-center justify-between">
        <View className="flex-row items-center gap-[6px]">
          <ClockGlyph size={16} />
          <Text className="font-noto text-[12.5px] text-muted">다음 일정</Text>
        </View>
        <Text className="font-noto text-[12.5px] text-muted">
          {nextPlan.dateLabel}
        </Text>
      </View>
      {/* 거리만 표기(INV-3) — '도보 850m'. within(next-plan)으로 스코프하는 A-5의 대상 텍스트 */}
      <Text className="w-full font-noto-bold text-card-title font-bold text-ink">
        {nextPlan.summary}
      </Text>
      <View className="w-full gap-[6px]">
        <View className="w-full flex-row items-center justify-between">
          <Text className="font-noto text-[12.5px] text-muted">
            {nextPlan.prepLabel}
          </Text>
          <Text className="font-inter-bold text-[12.5px] font-bold text-primary">
            {nextPlan.prepPercent}
          </Text>
        </View>
        <View className="h-[6px] w-full flex-row overflow-hidden rounded-pill bg-hairline">
          <View
            style={{ flex: nextPlan.prepRatio }}
            className="h-full bg-primary"
          />
          <View style={{ flex: 1 - nextPlan.prepRatio }} className="h-full" />
        </View>
      </View>
    </View>
  );
}

// ── 이어서 하기 카드 ────────────────────────────────────────────────────
function ResumeCard({ resume }: { resume: HomeResume }): ReactElement {
  return (
    <View
      testID="home-dashboard-resume"
      style={softCardShadow}
      className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas py-md pl-md pr-[14px]"
    >
      <View className="h-[46px] w-[46px] items-center justify-center rounded-button bg-primary-pale">
        <PencilGlyph size={22} />
      </View>
      <View className="flex-1 gap-[3px]">
        <Text className="font-noto-bold text-[11.5px] font-bold text-primary-text">
          이어서 하기
        </Text>
        <Text className="font-noto-bold text-[14.5px] font-bold text-ink">
          {resume.title}
        </Text>
        <Text className="font-noto text-caption text-muted">{resume.meta}</Text>
      </View>
      <ChevronRightGlyph size={20} />
    </View>
  );
}

// ── 인기 장소 카드 1장 ──────────────────────────────────────────────────
function PopularCard({
  place,
  index,
}: {
  place: HomePopularPlace;
  index: number;
}): ReactElement {
  return (
    <View
      testID={`home-dashboard-popular-card-${index}`}
      className="w-[108px] gap-[6px]"
    >
      <View className="h-[74px] w-[108px] rounded-button bg-surface-strong" />
      <Text className="font-noto-bold text-label font-bold text-ink">
        {place.name}
      </Text>
      {place.hot ? (
        <View className="flex-row items-center gap-[3px]">
          <FlameGlyph size={12} />
          <Text className="font-noto-bold text-caption font-bold text-primary-text">
            급상승
          </Text>
        </View>
      ) : (
        <Text className="font-noto text-caption text-muted">{place.stat}</Text>
      )}
    </View>
  );
}

// ── 인기 장소 섹션(3상태) ───────────────────────────────────────────────
function PopularSectionBlock({
  sections,
}: {
  sections: HomeSections;
}): ReactElement {
  if (sections.kind === 'ready') {
    return (
      <View className="w-full gap-md">
        <SectionHeader
          title="지금 인기 있는 장소"
          showMore
          moreTestID="home-dashboard-popular-more"
        />
        <View className="flex-row gap-[11px]">
          {sections.popular.map((place, index) => (
            <PopularCard key={place.name} place={place} index={index} />
          ))}
        </View>
      </View>
    );
  }
  if (sections.kind === 'empty') {
    return (
      <View className="w-full gap-md">
        <SectionHeader title="지금 인기 있는 장소" showMore={false} />
        <View
          testID="home-dashboard-taste-setup"
          className="w-full items-center gap-[14px] rounded-card border-[1.5px] border-dashed border-hairline-strong bg-canvas px-lg py-[28px]"
        >
          <Text className="text-center font-noto text-label text-muted">
            {'온보딩 취향을 설정하면\n더 맞춤화된 추천을 받을 수 있어요'}
          </Text>
          <Pressable
            testID="home-dashboard-taste-setup-cta"
            accessibilityRole="button"
            onPress={undefined}
            className="items-center justify-center rounded-button bg-primary px-[22px] py-md"
          >
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              취향 설정
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View className="w-full gap-md">
      <SectionHeader title="지금 인기 있는 장소" showMore={false} />
      <View
        testID="home-dashboard-skeleton-popular"
        className="flex-row gap-[11px]"
      >
        {[0, 1, 2].map((i) => (
          <View key={i} className="w-[108px] gap-[8px]">
            <View className="h-[74px] w-[108px] rounded-button bg-[#e9e9e9]" />
            <View className="h-[11px] w-[74px] rounded-[6px] bg-[#e9e9e9]" />
            <View className="h-[10px] w-[52px] rounded-[5px] bg-[#e9e9e9]" />
          </View>
        ))}
      </View>
    </View>
  );
}

// ── 취향 블록(default 전용) ─────────────────────────────────────────────
function TasteBlockSection({ taste }: { taste: HomeTasteBlock }): ReactElement {
  return (
    <View className="w-full gap-md">
      <SectionHeader title="내 취향 여행지" showMore />
      <View testID="home-dashboard-taste" className="w-full gap-md">
        <View className="flex-row gap-sm">
          {taste.chips.map((chip) => (
            <View
              key={chip}
              className="rounded-pill bg-primary-pale px-md py-[6px]"
            >
              <Text className="font-noto-bold text-caption font-bold text-primary-text">
                {chip}
              </Text>
            </View>
          ))}
        </View>
        <View
          style={softCardShadow}
          className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas py-md pl-md pr-[14px]"
        >
          <View className="h-[88px] w-[88px] rounded-button bg-surface-strong" />
          <View className="flex-1 gap-[5px]">
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {taste.featured.name}
            </Text>
            <Text className="font-noto text-label text-body">
              {taste.featured.description}
            </Text>
            <View className="rounded-pill bg-primary-pale px-[9px] py-[4px]">
              <Text className="font-noto-bold text-[11.5px] font-bold text-primary-text">
                {taste.featured.badge}
              </Text>
            </View>
          </View>
          <HeartOutlineGlyph size={22} />
        </View>
      </View>
    </View>
  );
}

// ── 새 여행 만들기 버튼 ─────────────────────────────────────────────────
function NewTripButton(): ReactElement {
  return (
    <Pressable
      testID="home-dashboard-new-trip"
      accessibilityRole="button"
      onPress={undefined}
      className="h-12 w-full flex-row items-center justify-center gap-sm rounded-button border border-hairline-strong bg-canvas"
    >
      <PlusGlyph size={20} tone="ink" />
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        새 여행 만들기
      </Text>
    </Pressable>
  );
}

// ── 커뮤니티(공개 기록) 섹션(3상태) ─────────────────────────────────────
function CommunitySectionBlock({
  sections,
}: {
  sections: HomeSections;
}): ReactElement {
  if (sections.kind === 'ready') {
    const record = sections.record;
    return (
      <View className="w-full gap-md">
        <SectionHeader title="지금 뜨는 · 내 취향 여행 기록" showMore />
        <View
          testID="home-dashboard-record-card"
          style={heroCardShadow}
          className="w-full gap-md rounded-card border border-hairline bg-canvas p-[14px]"
        >
          <View className="w-full flex-row items-center justify-between">
            <View className="flex-row items-center gap-[10px]">
              <View className="h-9 w-9 items-center justify-center rounded-pill bg-primary-pale">
                <Text className="font-noto-bold text-body font-bold text-primary-text">
                  {record.authorInitial}
                </Text>
              </View>
              <View className="gap-[3px]">
                <Text className="font-noto-bold text-body font-bold text-ink">
                  {record.author}
                </Text>
                <Text className="font-noto text-caption text-muted">
                  {record.authorTaste}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center gap-[4px] rounded-pill bg-primary-pale py-[4px] pl-[9px] pr-[11px]">
              <FlameGlyph size={12} />
              <Text className="font-noto-bold text-caption font-bold text-primary-text">
                인기
              </Text>
            </View>
          </View>
          <View className="w-full flex-row items-start gap-md">
            <View className="flex-1 gap-[9px]">
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                {record.title}
              </Text>
              <View className="flex-row gap-[6px]">
                {record.chips.map((chip) => (
                  <View
                    key={chip}
                    className="rounded-pill bg-surface-soft px-[9px] py-[4px]"
                  >
                    <Text className="font-noto text-caption text-body">
                      {chip}
                    </Text>
                  </View>
                ))}
              </View>
              <Text className="font-noto text-caption text-muted">
                {record.meta}
              </Text>
              <View className="flex-row items-center gap-[14px]">
                <View className="flex-row items-center gap-[4px]">
                  <LikeHeartGlyph size={15} />
                  <Text className="font-inter-bold text-label font-bold text-ink">
                    {record.likes}
                  </Text>
                </View>
                <View className="flex-row items-center gap-[4px]">
                  <CommentGlyph size={15} />
                  <Text className="font-inter-bold text-label font-bold text-muted">
                    {record.comments}
                  </Text>
                </View>
              </View>
            </View>
            <View className="h-[96px] w-[96px] items-center justify-center rounded-button border border-hairline bg-canvas-alt">
              <RouteDotsGlyph size={56} />
            </View>
          </View>
        </View>
      </View>
    );
  }
  if (sections.kind === 'empty') {
    return (
      <View className="w-full gap-md">
        <SectionHeader title="지금 뜨는 · 내 취향 여행 기록" showMore={false} />
        <View
          testID="home-dashboard-records-empty"
          className="w-full items-center gap-[7px] rounded-card border-[1.5px] border-dashed border-hairline-strong bg-canvas px-lg py-[26px]"
        >
          <Text className="text-center font-noto-bold text-card-title font-bold text-ink">
            아직 공유된 여행 기록이 없어요
          </Text>
          <Text className="text-center font-noto text-label text-muted">
            관심 장소를 저장하면 취향에 맞는 기록을 추천해 드려요
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View className="w-full gap-md">
      <SectionHeader title="지금 뜨는 · 내 취향 여행 기록" showMore={false} />
      <View
        testID="home-dashboard-skeleton-record"
        style={softCardShadow}
        className="w-full gap-[14px] rounded-card border border-hairline bg-canvas p-[14px]"
      >
        <View className="flex-row items-center gap-[10px]">
          <View className="h-9 w-9 rounded-pill bg-[#e9e9e9]" />
          <View className="gap-[7px]">
            <View className="h-3 w-[100px] rounded-[6px] bg-[#e9e9e9]" />
            <View className="h-[10px] w-[66px] rounded-[5px] bg-[#e9e9e9]" />
          </View>
        </View>
        <View className="w-full gap-[10px]">
          <View className="h-[13px] w-[160px] rounded-[6px] bg-[#e9e9e9]" />
          <View className="h-[11px] w-full rounded-[6px] bg-[#e9e9e9]" />
          <View className="h-[11px] w-[120px] rounded-[6px] bg-[#e9e9e9]" />
          <View className="h-[11px] w-[84px] rounded-[6px] bg-[#e9e9e9]" />
        </View>
      </View>
    </View>
  );
}

export function HomeScreen({
  trip,
  nextPlan,
  resume,
  taste,
  sections,
}: HomeScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="home-dashboard-root" className="flex-1 bg-canvas">
        <TopBar />
        <ScrollView className="flex-1">
          <View className="w-full gap-[22px] px-lg pb-xl pt-sm">
            {trip ? <HeroCard trip={trip} /> : <EmptyHeroCard />}
            {nextPlan ? <NextPlanCard nextPlan={nextPlan} /> : null}
            {resume ? <ResumeCard resume={resume} /> : null}

            {/* 새 여행 만들기 위치는 Figma상 상태별로 다르다: 취향 블록이 있으면(default) 그
                뒤, 없으면(no-trip·empty·loading) hero 바로 다음 — 02a §4-C 픽스처 관측대로. */}
            {!taste ? <NewTripButton /> : null}

            <PopularSectionBlock sections={sections} />

            {taste ? <TasteBlockSection taste={taste} /> : null}
            {taste ? <NewTripButton /> : null}

            <CommunitySectionBlock sections={sections} />
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
