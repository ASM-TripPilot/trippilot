/**
 * a01-home "발견·영감 피드" 프레젠테이션 화면 (TRIP-316 · 라이브 Figma 2091:1357 정합, 3상태).
 * props(hero·sections)만 받는다 — 네트워크·라우팅을 전혀 모른다(기계 강제 없음).
 * 배선 CTA 3종(FAB·담은 곳·뜨는 장소 더보기)은 넘겨받은 콜백 prop만 발화하고(라우터 무지, D-1),
 * 목적지 없는 컨트롤은 accessibilityRole="button"을 떼 접근성 트리에서 버튼이 아니다(TRIP-370).
 *
 * 구성: 인사 헤더 → 검색바 → magazineHero(영감 카드) → "요즘 사람들이 담는 곳"(가로 스크롤) →
 * "지금 뜨는 장소"(2×2 그리드) → softNote(장소 온램프) → FAB.
 * 서버 사진이 없으면 카테고리별 번들 생성 이미지(`PlacePhoto`) + 스크림 그라디언트로 채운다.
 *
 * TRIP-317 — 여행 단계 얼굴 4종을 phase 판별값으로 얹는다(collecting·planning·upcoming·postTrip).
 * 화면은 phase.kind로 스위치만 하고 여행 데이터를 뜯어 단계를 스스로 도출하지 않는다(TRIP-206
 * S-6). phase 미전달/discovery → 316 얼굴 폴백. 각 얼굴은 브리프 §3 델타대로 공유 부품(tripHero·
 * softNote·미니맵 카드 등)을 단계 데이터로 파라미터화해 조립한다. INV-3(소요시간 미표시)는
 * 어떤 얼굴에도 소요시간 문자열·필드를 두지 않는다 — 시각(09:30)·거리(950m)만 표시한다.
 */
import type { ReactElement } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CreateTripFab, SavedMenuFab } from './HomeFabs';
import { GreetingHeader, homeGreeting, SearchBarBlock } from './HomeHeader';
import { PhaseBody } from './HomePhaseBody';
import { FAB_STACK_TOP } from '@/shared/ui/toastBottom';
import { useScrollHide } from '@/shared/lib/useScrollHide';
import { useToastBottom } from '@/shared/ui/useToastBottom';
import type { HomeScreenProps } from '../model/homeTypes';

export function HomeScreen({
  hero,
  sections,
  spotsLane,
  collectionsLane,
  tripsError,
  tripsOffline,
  phase,
  onPressCreateTrip,
  onPressSavedPlaces,
  onPressSavedStays,
  onPressSpotsMore,
  onPressPastTripsMore,
  onPressTripHeroCta,
  onPressSearch,
  onPressHeroCity,
  onPressBell,
  onPressAssistant,
  savedPlacesCount,
  savedStaysCount,
  unreadCount,
  savedMenuOpen,
  onToggleSavedMenu,
}: HomeScreenProps): ReactElement {
  useToastBottom(FAB_STACK_TOP); // 토스트가 FAB 스택 위로 뜬다(TRIP-1559)
  const menuOpen = savedMenuOpen ?? false;
  // 스크롤하는 동안 FAB 을 숨긴다(TRIP-1435 Q-023 결정 1=A — 본문 요소를 덮지 않게). 메뉴가 열려 있으면 딤·미니 FAB 을
  // 그대로 둔다 — 스크롤 숨김은 닫힌 상태의 FAB 만 다룬다.
  const { hidden: fabsHidden, onScroll: handleScroll } =
    useScrollHide(menuOpen);
  const greeting = homeGreeting(phase);
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="home-dashboard-root" className="flex-1 bg-canvas">
        <Animated.ScrollView
          testID="home-dashboard-scroll"
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 220 }}
          scrollEventThrottle={16}
          onScroll={handleScroll}
        >
          <GreetingHeader
            title={greeting.title}
            subtitle={greeting.subtitle}
            name={greeting.name}
            unreadCount={unreadCount}
            onPressBell={onPressBell}
            onPressAssistant={onPressAssistant}
          />
          <SearchBarBlock onPress={onPressSearch} />
          <PhaseBody
            hero={hero}
            sections={sections}
            spotsLane={spotsLane}
            collectionsLane={collectionsLane}
            tripsError={tripsError}
            tripsOffline={tripsOffline}
            phase={phase}
            onPressSpotsMore={onPressSpotsMore}
            onPressPastTripsMore={onPressPastTripsMore}
            onPressTripHeroCta={onPressTripHeroCta}
            onPressHeroCity={onPressHeroCity}
          />
        </Animated.ScrollView>
        {/* TRIP-699 — 로딩이면 두 FAB 숨김(Figma 2174:2307). 로딩은 항상 discovery라 phase 없음. */}
        {sections.kind !== 'loading' ? (
          <View
            testID="home-fab-layer"
            pointerEvents={fabsHidden ? 'none' : 'box-none'}
            style={{ opacity: fabsHidden ? 0 : 1 }}
            className="absolute inset-0"
          >
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
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
