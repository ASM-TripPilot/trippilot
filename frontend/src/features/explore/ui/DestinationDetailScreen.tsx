/**
 * d03 목적지 상세 — 순수 프레젠테이션(TRIP-183 "준비 중" 스텁을 실화면으로 교체, 2026-08-22).
 *
 * `RegionPickerScreen`(d1b, purpose='trip')에서 지역 카드를 고르면 오는 화면. Figma d05
 * "통합 검색 결과"(2176:2336) 골격 — 헤딩 `'{지역}' 검색 결과` + 검색바 + 3레인(숙소·장소·
 * 여행자 일정) — 을 자유 검색어 대신 **고른 지역 하나로 고정**해 재사용한다. d05 자체(자유
 * 검색어 화면, `/explore/search`)는 TRIP-499로 은퇴했으므로 이 화면과는 별개다 — 검색바는
 * 자유 입력을 받지 않는 **진입 버튼**이다(`ExploreLandingScreen.onPressSearch`와 같은 성격,
 * TRIP-412 선례) — 누르면 다른 지역을 다시 고르러 d1b 여행지 선택으로 돌아간다(뒤로가기가
 * 없는 이 화면에서 "다시 검색"의 유일한 입구, 2026-08-22 요청).
 *
 * 여행자 일정 레인은 공개 목록 API 계약이 없어(BR-U1-05) `ExploreLandingScreen`과 같은
 * "준비 중" 자리를 그대로 쓴다 — 이 화면은 그 레인의 데이터를 요구하지 않는다.
 *
 * `(tabs)` 밖 라우트(`/explore/destination/{code}`)라 진짜 탭바가 없다 — `/stays`(e02)와
 * 같은 방식으로 `BottomTabBar`를 복제해 그린다. 단 이 화면은 뒤로가기 버튼을 두지 않는다
 * (2026-08-22 요청) — 여행지 선택(d1b)에서 온 스택 뒤로 두 번 나가는 대신, 하단 탭을 눌러
 * 바로 다른 탭으로 옮겨가는 탐색 탭과 같은 포지션으로 둔다. 담은 곳 하트 FAB도 d01
 * `ExploreLandingScreen`의 `savedMenu`와 같은 모양(펼치면 담은 장소·저장한 숙소 두 미니
 * FAB)을 그대로 재사용한다.
 */
import type { ReactElement } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabBar, type ShellTabKey } from '@/shared/ui/BottomTabBar';

import {
  CloseGlyph,
  HeartFilledGlyph,
  InfoGlyph,
  MapPinGlyph,
  SearchGlyph,
  SuitcaseGlyph,
  WarningTriangleGlyph,
} from './ExploreGlyphs';
import type { PlaceCardVM, StayCardVM } from './ExploreLandingScreen';

export interface DestinationDetailScreenProps {
  regionName: string;
  /** 검색바(진입 버튼) press — 다른 지역을 고르러 d1b 여행지 선택으로 돌아간다. */
  onPressSearch: () => void;
  stayLane: {
    error: boolean;
    cards: StayCardVM[];
    onRetry: () => void;
    onSeeAll: () => void;
    onPressCard: (card: StayCardVM) => void;
  };
  placeLane: {
    error: boolean;
    cards: PlaceCardVM[];
    onRetry: () => void;
    onSeeAll: () => void;
    onPressCard: (poiId: string) => void;
  };
  /** 하단 탭 press(뒤로가기 대체) — 목적지는 페이지가 정한다(`/stays` `onPressTab` 선례). */
  onPressTab: (key: ShellTabKey) => void;
  /** 담은 곳 하트 FAB(`ExploreLandingScreen.savedMenu`와 동일 계약). */
  savedMenu: {
    open: boolean;
    savedCount: number;
    onToggle: () => void;
    onPressSavedPlaces: () => void;
    onPressSavedStays: () => void;
  };
}

// 담은 곳 FAB 그림자 — `ExploreLandingScreen.tsx`의 FAB_SHADOW와 동형(RN에 CSS box-shadow가
// 없어 style prop으로 옮긴다). raw-hex 가드 사정거리 밖(홈 fabShadow 선례).
const FAB_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.22,
  shadowRadius: 12,
  elevation: 6,
} as const;

function LaneHeader({
  title,
  onSeeAll,
  seeAllTestID,
}: {
  title: string;
  onSeeAll: () => void;
  seeAllTestID: string;
}): ReactElement {
  return (
    <View className="mb-md flex-row items-center justify-between">
      <Text className="font-noto-bold text-section font-bold text-ink">
        {title}
      </Text>
      <Pressable
        testID={seeAllTestID}
        accessibilityRole="button"
        onPress={onSeeAll}
        className="flex-row items-center gap-xs"
      >
        <Text className="font-noto text-label text-muted">모두 보기</Text>
        <Text className="font-noto text-label text-muted">›</Text>
      </Pressable>
    </View>
  );
}

// 두 레인이 같은 "불러오지 못했어요 + 다시 시도" 모양을 쓴다 — 문구만 갈라 한 곳에 둔다
// (ExploreLandingScreen의 StayLaneError 선례, 여긴 stay·place 둘이 같은 모양이라 파라미터화).
function LaneErrorBlock({
  message,
  onRetry,
  testID,
}: {
  message: string;
  onRetry: () => void;
  testID: string;
}): ReactElement {
  return (
    <View className="items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl">
      <WarningTriangleGlyph size={28} tone="primary" />
      <Text className="font-noto text-label text-muted">{message}</Text>
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

// 사진은 계약(StayItem)에 URL 필드가 없어 회색 자리(surface-strong)로 둔다(INV-1). 저장
// 하트는 이 화면 스코프 밖 — 목록 화면(d01)에만 배선돼 있다.
function StayCard({
  card,
  onPress,
}: {
  card: StayCardVM;
  onPress: (card: StayCardVM) => void;
}): ReactElement {
  return (
    <Pressable
      testID={`destination-detail-stay-card-${card.key}`}
      accessibilityRole="button"
      onPress={() => onPress(card)}
      className="w-[200px]"
    >
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
    </Pressable>
  );
}

// `imageUrl` 이 있을 때만 사진을 그린다 — 없으면 회색 플레이스홀더(발명 금지, INV-1).
function PlaceCard({
  card,
  onPress,
}: {
  card: PlaceCardVM;
  onPress: (poiId: string) => void;
}): ReactElement {
  return (
    <Pressable
      testID={`destination-detail-place-card-${card.poiId}`}
      accessibilityRole="button"
      onPress={() => onPress(card.poiId)}
      className="w-[150px]"
    >
      {card.imageUrl ? (
        <Image
          testID={`destination-detail-place-card-image-${card.poiId}`}
          source={{ uri: card.imageUrl }}
          resizeMode="cover"
          className="h-[110px] w-full rounded-card bg-surface-strong"
        />
      ) : (
        <View className="h-[110px] w-full rounded-card bg-surface-strong" />
      )}
      <Text
        numberOfLines={1}
        className="mt-sm font-noto-bold text-card-title font-bold text-ink"
      >
        {card.name}
      </Text>
      <Text numberOfLines={1} className="mt-xs font-noto text-label text-muted">
        {card.region}
      </Text>
    </Pressable>
  );
}

export function DestinationDetailScreen({
  regionName,
  onPressSearch,
  stayLane,
  placeLane,
  onPressTab,
  savedMenu,
}: DestinationDetailScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="destination-detail-root" className="flex-1 bg-canvas">
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          // FAB(absolute bottom-100+h-56=156)·복제 탭바(96) 오버레이가 마지막 레인을
          // 가리지 않도록 스크롤 끝 여백을 156까지 확보한다(ExploreLandingScreen·
          // StaySearchScreen과 같은 값).
          contentContainerStyle={{
            paddingTop: 12,
            paddingHorizontal: 16,
            paddingBottom: 156,
          }}
        >
          <View testID="destination-detail-heading">
            <Text className="font-noto-bold text-hero font-bold text-ink">
              &apos;{regionName}&apos; 검색 결과
            </Text>
            <Text className="mt-xs font-noto text-label text-muted">
              숙소 · 장소 · 여행자 일정에서 찾았어요
            </Text>
          </View>

          {/* 검색바 — 입력 불가 진입 버튼(자유 문자열을 안 다룬다, TRIP-412 관례). 누르면
              d1b 여행지 선택으로 돌아가 다른 지역을 고른다. */}
          <Pressable
            testID="destination-detail-search"
            accessibilityRole="button"
            onPress={onPressSearch}
            className="mt-lg h-[52px] flex-row items-center gap-sm rounded-pill border border-hairline-strong bg-canvas px-lg"
          >
            <SearchGlyph size={20} />
            <Text className="flex-1 font-noto text-body text-ink">
              {regionName}
            </Text>
          </Pressable>

          <View testID="destination-detail-lane-stay" className="mt-2xl">
            <LaneHeader
              title="숙소"
              onSeeAll={stayLane.onSeeAll}
              seeAllTestID="destination-detail-stay-seeall"
            />
            {stayLane.error ? (
              <LaneErrorBlock
                testID="destination-detail-stay-retry"
                message="숙소를 불러오지 못했어요"
                onRetry={stayLane.onRetry}
              />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-md">
                  {stayLane.cards.map((card) => (
                    <StayCard
                      key={card.key}
                      card={card}
                      onPress={stayLane.onPressCard}
                    />
                  ))}
                </View>
              </ScrollView>
            )}
          </View>

          <View testID="destination-detail-lane-place" className="mt-2xl">
            <LaneHeader
              title="장소"
              onSeeAll={placeLane.onSeeAll}
              seeAllTestID="destination-detail-place-seeall"
            />
            {placeLane.error ? (
              <LaneErrorBlock
                testID="destination-detail-place-retry"
                message="장소를 불러오지 못했어요"
                onRetry={placeLane.onRetry}
              />
            ) : placeLane.cards.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-md">
                  {placeLane.cards.map((card) => (
                    <PlaceCard
                      key={card.poiId}
                      card={card}
                      onPress={placeLane.onPressCard}
                    />
                  ))}
                </View>
              </ScrollView>
            ) : (
              <Pressable
                testID="destination-detail-place-empty"
                accessibilityRole="button"
                onPress={placeLane.onSeeAll}
                className="flex-row items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl"
              >
                <SearchGlyph size={18} />
                <Text className="flex-1 font-noto text-label text-muted">
                  가볼 만한 장소 둘러보기
                </Text>
                <Text className="font-noto text-label text-muted">›</Text>
              </Pressable>
            )}
          </View>

          {/* 여행자 일정 — 자리만(BR-U1-05, ExploreLandingScreen과 같은 문구). */}
          <View testID="destination-detail-lane-itin" className="mt-2xl">
            <View className="mb-md flex-row items-center justify-between">
              <Text className="font-noto-bold text-section font-bold text-ink">
                여행자 일정
              </Text>
            </View>
            <View className="flex-row items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl">
              <InfoGlyph size={18} />
              <Text className="font-noto text-label text-muted">
                여행자들의 일정을 준비 중이에요
              </Text>
            </View>
          </View>
        </ScrollView>

        <BottomTabBar activeKey="explore" onPressTab={onPressTab} />

        {/* 담은 곳 하트 FAB — `ExploreLandingScreen.savedMenu`와 같은 모양(펼치면 담은
            장소→d02·저장한 숙소→e04 두 미니 FAB). */}
        {savedMenu.open ? (
          <Pressable
            testID="destination-detail-saved-menu-backdrop"
            accessibilityRole="button"
            accessibilityLabel="담은 곳 메뉴 닫기"
            onPress={savedMenu.onToggle}
            className="absolute inset-0 bg-scrim/40"
          />
        ) : null}
        <View className="absolute bottom-[100px] right-lg flex-row items-center gap-md">
          {savedMenu.open ? (
            <>
              <Pressable
                testID="destination-detail-saved-places-fab"
                accessibilityRole="button"
                accessibilityLabel={`담은 장소 ${savedMenu.savedCount}곳`}
                onPress={savedMenu.onPressSavedPlaces}
                style={FAB_SHADOW}
                className="h-[56px] w-[56px] items-center justify-center rounded-full bg-canvas"
              >
                <MapPinGlyph size={26} tone="primary" />
              </Pressable>
              <Pressable
                testID="destination-detail-saved-stays-fab"
                accessibilityRole="button"
                accessibilityLabel="저장한 숙소"
                onPress={savedMenu.onPressSavedStays}
                style={FAB_SHADOW}
                className="h-[56px] w-[56px] items-center justify-center rounded-full bg-canvas"
              >
                <SuitcaseGlyph size={26} />
              </Pressable>
            </>
          ) : null}
          <Pressable
            testID="destination-detail-saved-menu-toggle"
            accessibilityRole="button"
            accessibilityLabel={
              savedMenu.open
                ? '담은 곳 메뉴 닫기'
                : `담은 곳 ${savedMenu.savedCount}곳`
            }
            onPress={savedMenu.onToggle}
            style={FAB_SHADOW}
            className={`h-[56px] w-[56px] items-center justify-center rounded-full ${
              savedMenu.open ? 'bg-primary' : 'bg-canvas'
            }`}
          >
            {savedMenu.open ? (
              <CloseGlyph size={24} />
            ) : (
              <HeartFilledGlyph size={26} />
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
