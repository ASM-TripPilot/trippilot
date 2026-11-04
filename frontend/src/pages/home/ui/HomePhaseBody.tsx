// 홈 얼굴(phase)별 본문 — discovery·planning·postTrip 과 그 셋을 고르는 PhaseBody.
import type { ReactElement } from 'react';
import { View } from 'react-native';

import { TripsLoadError, TripsOfflineNotice } from './HomeHeader';
import { DiscoveryHeroCarousel, PlanningHeroCarousel } from './HomeHeroes';
import {
  CollectionStrip,
  CollectionsSection,
  PastTripsSection,
  SpotsSection,
} from './HomeSections';
import { Skeleton } from '@/shared/ui/Skeleton';
import type {
  HomeCollectionsLane,
  HomeMagazineHero,
  HomePhase,
  HomeScreenProps,
  HomeSections,
  HomeSpotsLane,
} from '../model/homeTypes';

// ── discovery 얼굴(316 발견·영감 피드) ──────────────────────────────────
function DiscoveryBody({
  hero,
  sections,
  spotsLane,
  collectionsLane,
  tripsError,
  tripsOffline,
  onPressSpotsMore,
  onPressHeroCity,
}: {
  hero: readonly HomeMagazineHero[];
  sections: HomeSections;
  spotsLane?: HomeSpotsLane;
  collectionsLane?: HomeCollectionsLane;
  tripsError?: HomeScreenProps['tripsError'];
  tripsOffline?: boolean;
  onPressSpotsMore?: () => void;
  onPressHeroCity?: (regionCode: string) => void;
}): ReactElement {
  return (
    <>
      {tripsError ? (
        <TripsLoadError
          onRetry={tripsError.onRetry}
          retrying={tripsError.retrying}
        />
      ) : null}
      {tripsOffline ? <TripsOfflineNotice /> : null}
      {/* TRIP-699 — 로딩이면 히어로는 캐러셀이 아니라 통짜 스켈레톤(390×470, Figma 2174:2307). */}
      {sections.kind === 'loading' ? (
        <Skeleton
          testID="home-hero-skeleton"
          className="h-[470px] w-full bg-surface-strong"
        />
      ) : (
        <DiscoveryHeroCarousel
          heroes={hero}
          onPressHeroCity={onPressHeroCity}
        />
      )}
      <View className="w-full gap-[24px] pb-sm pt-[22px]">
        <CollectionsSection sections={sections} lane={collectionsLane} />
        <SpotsSection
          sections={sections}
          onMore={onPressSpotsMore}
          lane={spotsLane}
        />
      </View>
    </>
  );
}

// ── planning 얼굴(계획 중 · 여행 중 · TRIP-696 풀블리드 통합 히어로 재작성) ────────────────
// (인사 헤더는 HomeScreen 이 그린다 — 문구는 HomeHeader 의 homeGreeting) 통합 히어로 캐러셀(page0 트립·page1~3 도시 카드) ·
// 본문은 컬렉션 1섹션(계획 중), phase.showSpots 면 "지금 뜨는 장소"까지 2섹션(TRIP-697 여행 중).
// SpotsSection 정의는 discovery 도 써서 공유한다.
function PlanningBody({
  phase,
  hero,
  sections,
  spotsLane,
  collectionsLane,
  onPressSpotsMore,
  onPressTripHeroCta,
  onPressHeroCity,
}: {
  phase: Extract<HomePhase, { kind: 'planning' }>;
  hero: readonly HomeMagazineHero[];
  sections: HomeSections;
  spotsLane?: HomeSpotsLane;
  collectionsLane?: HomeCollectionsLane;
  onPressSpotsMore?: () => void;
  onPressTripHeroCta?: () => void;
  onPressHeroCity?: (regionCode: string) => void;
}): ReactElement {
  return (
    <>
      <PlanningHeroCarousel
        trip={phase.trip}
        heroes={hero}
        onPressTripCta={onPressTripHeroCta}
        onPressHeroCity={onPressHeroCity}
      />
      <View className="w-full gap-[24px] pb-sm pt-[22px]">
        <CollectionsSection
          sections={sections}
          title={phase.collectionsTitle}
          lane={collectionsLane}
        />
        {phase.showSpots ? (
          <SpotsSection
            sections={sections}
            onMore={onPressSpotsMore}
            lane={spotsLane}
          />
        ) : null}
      </View>
    </>
  );
}

// ── postTrip 얼굴(다녀옴 · TRIP-698 통합 히어로 재작성) ───────────────────
// (인사 헤더는 HomeScreen 이 그린다) 통합 히어로 캐러셀(page0 트립="여행 완료"·page1~3
// 도시 카드 — planning 과 부품 공유) · 섹션 순서 반전(지난 여행 가로 사진 카드 → "다음엔 여기
// 어때요" 추천 스트립). 구 회색 회고 카드(MiniMapCard)·공유행은 제거됐다(01b). 회고 CTA 콜백은
// onPressTripHeroCta 재사용(라이브 미도달이라 프리뷰에선 undefined).
function PostTripBody({
  phase,
  hero,
  sections,
  collectionsLane,
  onPressPastTripsMore,
  onPressTripHeroCta,
  onPressHeroCity,
}: {
  phase: Extract<HomePhase, { kind: 'postTrip' }>;
  hero: readonly HomeMagazineHero[];
  sections: HomeSections;
  collectionsLane?: HomeCollectionsLane;
  onPressPastTripsMore?: () => void;
  onPressTripHeroCta?: () => void;
  onPressHeroCity?: (regionCode: string) => void;
}): ReactElement {
  return (
    <>
      <PlanningHeroCarousel
        trip={phase.trip}
        heroes={hero}
        onPressTripCta={onPressTripHeroCta}
        onPressHeroCity={onPressHeroCity}
      />
      <View className="w-full gap-[24px] pb-sm pt-[22px]">
        {/* 라이브는 지난 여행이 없을 수 있다 — 빈 섹션 헤더만 남기지 않는다(TRIP-1369). */}
        {phase.pastTrips.length > 0 ? (
          <PastTripsSection
            trips={phase.pastTrips}
            onPressMore={onPressPastTripsMore}
          />
        ) : null}
        {/* 라이브는 서버 장소 레인(TRIP-1209), 레인이 없는 프리뷰만 phase 의 고정 추천을 그린다. */}
        {collectionsLane ? (
          <CollectionsSection
            sections={sections}
            title={phase.recommendationTitle}
            lane={collectionsLane}
          />
        ) : (
          <CollectionStrip
            title={phase.recommendationTitle}
            collections={phase.recommendations}
          />
        )}
      </View>
    </>
  );
}

// 화면은 phase.kind로 스위치만 한다(단계를 스스로 도출하지 않는다, TRIP-206 S-6).
export function PhaseBody({
  hero,
  sections,
  spotsLane,
  collectionsLane,
  tripsError,
  tripsOffline,
  phase,
  onPressSpotsMore,
  onPressPastTripsMore,
  onPressTripHeroCta,
  onPressHeroCity,
}: Omit<
  HomeScreenProps,
  'onPressBell' | 'onPressAssistant' | 'onPressSearch'
>): ReactElement {
  if (phase === undefined || phase.kind === 'discovery') {
    return (
      <DiscoveryBody
        hero={hero}
        sections={sections}
        spotsLane={spotsLane}
        collectionsLane={collectionsLane}
        tripsError={tripsError}
        tripsOffline={tripsOffline}
        onPressSpotsMore={onPressSpotsMore}
        onPressHeroCity={onPressHeroCity}
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
          spotsLane={spotsLane}
          collectionsLane={collectionsLane}
          onPressSpotsMore={onPressSpotsMore}
          onPressTripHeroCta={onPressTripHeroCta}
          onPressHeroCity={onPressHeroCity}
        />
      );
    case 'postTrip':
      return (
        <PostTripBody
          phase={phase}
          hero={hero}
          sections={sections}
          collectionsLane={collectionsLane}
          onPressPastTripsMore={onPressPastTripsMore}
          onPressTripHeroCta={onPressTripHeroCta}
          onPressHeroCity={onPressHeroCity}
        />
      );
  }
}
