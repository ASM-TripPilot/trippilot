/**
 * d03 목적지 상세 — 순수 프레젠테이션(TRIP-183 "준비 중" 스텁을 실화면으로 교체, 2026-08-22).
 *
 * `RegionPickerScreen`(d1b, purpose='explore')에서 지역 카드를 고르면 오는 화면. Figma d05
 * "통합 검색 결과"(2176:2336 → 2열 격자안 4663:2540) 골격 — 헤딩 `'{지역}' 검색 결과` + 검색바 +
 * 숙소 레인(가로) + 장소 격자(2열) — 을 자유 검색어 대신 **고른 지역 하나로 고정**해
 * 재사용한다. d05 자체(자유 검색어 화면, `/explore/search`)는 TRIP-499로 은퇴했으므로 이
 * 화면과는 별개다 — 검색바는 자유 입력을 받지 않는 **진입 버튼**이다
 * (`ExploreLandingScreen.onPressSearch`와 같은 성격, TRIP-412 선례) — 누르면 다른 지역을
 * 다시 고르러 d1b 여행지 선택으로 돌아간다(뒤로가기가 없는 이 화면에서 "다시 검색"의 유일한
 * 입구, 2026-08-22 요청).
 *
 * 두 레인은 늘 함께 보인다 — TRIP-709 의 세그먼트 3탭(레인 필터)은 TRIP-1048 이 없앴다. 옛
 * "여행자 일정" 레인은 제거됐다(G11).
 *
 * `(tabs)` 밖 라우트(`/explore/destination/{code}`)라 진짜 탭바가 없다 — `/stays`(e02)와
 * 같은 방식으로 `BottomTabBar`를 복제해 그린다. 단 이 화면은 뒤로가기 버튼을 두지 않는다
 * (2026-08-22 요청) — 여행지 선택(d1b)에서 온 스택 뒤로 두 번 나가는 대신, 하단 탭을 눌러
 * 바로 다른 탭으로 옮겨가는 탐색 탭과 같은 포지션으로 둔다. 담은 곳 하트 FAB도 d01
 * `ExploreLandingScreen`의 `savedMenu`와 같은 모양(펼치면 담은 장소·저장한 숙소 두 미니
 * FAB)을 그대로 재사용한다.
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PlaceCardVM } from '@/entities/place/model';
import {
  PlaceRailCard,
  type PlaceRailCardSave,
} from '@/entities/place/ui/PlaceRailCard';
import { StaySearchCard } from '@/entities/stay/ui/StaySearchCard';
import { BottomTabBar, type ShellTabKey } from '@/shared/ui/BottomTabBar';
import { HeartFilledGlyph } from '@/shared/ui/HeartGlyphs';

import {
  CloseGlyph,
  MapPinGlyph,
  PlusGlyph,
  SearchGlyph,
  SuitcaseGlyph,
  WarningTriangleGlyph,
} from './ExploreGlyphs';
import type { StayCardVM } from './ExploreLandingScreen';

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
    // 저장 하트(TRIP-709, d01 `ExploreLandingScreen.stayLane` 계약 동형) — 전부 additive·옵셔널.
    // 미지정 시 하트를 안 그린다(무회귀). 담김/미담김은 fill 색이 아니라 서로 다른 글리프 +
    // accessibilityState.selected 로 관측한다(글리프 fill 함정 회피). 배선은 페이지가 진다.
    savedKeys?: string[];
    pendingKeys?: string[];
    onToggleSave?: (card: StayCardVM) => void;
    saveError?: boolean;
    onDismissSaveError?: () => void;
  };
  placeLane: {
    error: boolean;
    cards: PlaceCardVM[];
    onRetry: () => void;
    onSeeAll: () => void;
    onPressCard: (poiId: string) => void;
    // 저장 하트(TRIP-1049) — 전부 additive·옵셔널. onToggleSave 가 있을 때만 하트를 그린다.
    savedPoiIds?: string[];
    pendingPoiIds?: string[];
    onToggleSave?: (poiId: string) => void;
    saveErrorMessage?: string | null;
    onDismissSaveError?: () => void;
  };
  /** 하단 탭 press(뒤로가기 대체) — 목적지는 페이지가 정한다(`/stays` `onPressTab` 선례). */
  onPressTab: (key: ShellTabKey) => void;
  /** 복제 탭바 활성 탭 — 진입 탭(홈 검색이면 home, TRIP-1015 E). 미지정이면 explore. */
  activeTab?: ShellTabKey;
  /** ＋ 여행 만들기 FAB press — 미지정이면 no-op(d01 계약 복제). */
  onPressCreateTrip?: () => void;
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

// 숙소 담기 실패 배너(INV-4 — 침묵 금지) — d01 `StaySaveErrorBanner` 선례 그대로. 탭하면 닫힌다
// (다음 하트 press 로도 소멸). 숙소 전용 일반 문구(장소 문구를 재사용하면 "장소"가 노출된다).
function StaySaveErrorBanner({
  onDismiss,
}: {
  onDismiss?: () => void;
}): ReactElement {
  return (
    <Pressable
      testID="destination-detail-stay-save-error"
      accessibilityRole="button"
      onPress={onDismiss}
      className="mb-md flex-row items-center gap-sm rounded-card bg-surface-soft px-lg py-md"
    >
      <WarningTriangleGlyph size={18} tone="primary" />
      <Text className="flex-1 font-noto text-label text-muted">
        담기에 실패했어요. 잠시 후 다시 시도해 주세요.
      </Text>
    </Pressable>
  );
}

// 장소 담기 실패 배너(TRIP-1049, INV-4) — 문구는 페이지가 담기/해제 갈래로 골라 준다.
function PlaceSaveErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}): ReactElement {
  return (
    <Pressable
      testID="destination-detail-place-save-error"
      accessibilityRole="button"
      onPress={onDismiss}
      className="mb-md flex-row items-center gap-sm rounded-card bg-surface-soft px-lg py-md"
    >
      <WarningTriangleGlyph size={18} tone="primary" />
      <Text className="flex-1 font-noto text-label text-muted">{message}</Text>
    </Pressable>
  );
}

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

// 장소 2열 격자(TRIP-1048, Figma 4663:2540) — 행마다 같은 폭(`flex-1`) 칸 2개. 홀수면 마지막 행
// 오른쪽에 빈 칸을 둬 마지막 카드가 한 줄 전체로 늘어나지 않게 한다. 바깥이 세로 ScrollView 라
// FlatList(numColumns)를 넣지 않는다(가상화 리스트 중첩 경고 · 최대 8장이라 이득도 없다).
function PlaceGrid({
  cards,
  onPressCard,
  saveFor,
}: {
  cards: PlaceCardVM[];
  onPressCard: (poiId: string) => void;
  saveFor: (poiId: string) => PlaceRailCardSave | undefined;
}): ReactElement {
  const rows = Array.from({ length: Math.ceil(cards.length / 2) }, (_, r) =>
    cards.slice(r * 2, r * 2 + 2)
  );
  return (
    // mr-[56px] = FAB 폭(TRIP-1076 AC-8) — 오른쪽 열 하트가 FAB 열(right-lg + 56)과 가로로 겹치지 않게
    // 격자만 비운다(스크롤 패딩을 늘리면 숙소 레인까지 줄어든다). Figma d05 는 16/16 대칭이라 갈라진다.
    <View testID="destination-detail-place-grid" className="mr-[56px] gap-md">
      {rows.map((pair) => (
        <View
          key={pair[0].poiId}
          testID="destination-detail-place-grid-row"
          className="flex-row gap-md"
        >
          {[pair[0], pair[1]].map((card, i) => (
            <View
              key={i}
              testID="destination-detail-place-grid-cell"
              className="flex-1"
            >
              {card ? (
                <PlaceRailCard
                  card={card}
                  onPress={onPressCard}
                  testIDPrefix="destination-detail-place-card"
                  variant="fill"
                  save={saveFor(card.poiId)}
                />
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function DestinationDetailScreen({
  regionName,
  onPressSearch,
  stayLane,
  placeLane,
  onPressTab,
  activeTab = 'explore',
  onPressCreateTrip,
  savedMenu,
}: DestinationDetailScreenProps): ReactElement {
  const {
    savedKeys = [],
    pendingKeys = [],
    onToggleSave,
    saveError = false,
    onDismissSaveError,
  } = stayLane;
  const {
    savedPoiIds = [],
    pendingPoiIds = [],
    onToggleSave: onTogglePlaceSave,
  } = placeLane;
  // 저장 배선(onToggleSave)이 있을 때만 하트를 그린다(AC-8 무회귀).
  const placeSaveFor = (poiId: string): PlaceRailCardSave | undefined =>
    onTogglePlaceSave
      ? {
          saved: savedPoiIds.includes(poiId),
          pending: pendingPoiIds.includes(poiId),
          onToggle: () => onTogglePlaceSave(poiId),
          testID: `destination-detail-place-save-${poiId}`,
          filledTestID: `destination-detail-place-heart-filled-${poiId}`,
          outlineTestID: `destination-detail-place-heart-outline-${poiId}`,
        }
      : undefined;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="destination-detail-root" className="flex-1 bg-canvas">
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          // FAB(absolute bottom-84+h-56=140 — 여백 156 은 그 위 16 여유)·복제 탭바(96) 오버레이가 마지막 레인을
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
              장소 · 숙소에서 찾았어요
            </Text>
          </View>

          {/* 검색바 — 입력 불가 진입 버튼(자유 문자열을 안 다룬다, TRIP-412 관례). 누르면
              d1b 여행지 선택으로 돌아가 다른 지역을 고른다. 트레일링 › 는 "다시 고르러 간다"는
              진입 신호(레인 헤더 › 선례 텍스트 글리프). */}
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
            <Text className="font-noto text-body text-muted-soft">›</Text>
          </Pressable>

          <View testID="destination-detail-lane-stay" className="mt-2xl">
            <LaneHeader
              title="숙소"
              onSeeAll={stayLane.onSeeAll}
              seeAllTestID="destination-detail-stay-seeall"
            />
            {saveError ? (
              <StaySaveErrorBanner onDismiss={onDismissSaveError} />
            ) : null}
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
                    // rail 카드 — 하트는 save 배선 시에만(미지정=하트 없음, AC-5d). 담김/미담김은
                    // 색이 아니라 서로 다른 글리프 testID + selected 로 관측(★1). 사진은 회색
                    // 자리(URL 계약 무·INV-1).
                    <StaySearchCard
                      key={card.key}
                      testID={`destination-detail-stay-card-${card.key}`}
                      name={card.name}
                      region={card.region}
                      priceText={card.priceText}
                      variant="rail"
                      save={
                        onToggleSave
                          ? {
                              saved: savedKeys.includes(card.key),
                              pending: pendingKeys.includes(card.key),
                              onToggle: () => onToggleSave(card),
                              testID: `destination-detail-stay-save-${card.key}`,
                              filledTestID: `destination-detail-stay-heart-filled-${card.key}`,
                              outlineTestID: `destination-detail-stay-heart-outline-${card.key}`,
                            }
                          : undefined
                      }
                      onPress={() => stayLane.onPressCard(card)}
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
            {placeLane.saveErrorMessage ? (
              <PlaceSaveErrorBanner
                message={placeLane.saveErrorMessage}
                onDismiss={placeLane.onDismissSaveError}
              />
            ) : null}
            {placeLane.error ? (
              <LaneErrorBlock
                testID="destination-detail-place-retry"
                message="장소를 불러오지 못했어요"
                onRetry={placeLane.onRetry}
              />
            ) : placeLane.cards.length > 0 ? (
              <PlaceGrid
                cards={placeLane.cards}
                onPressCard={placeLane.onPressCard}
                saveFor={placeSaveFor}
              />
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
        </ScrollView>

        <BottomTabBar activeKey={activeTab} onPressTab={onPressTab} />

        {/* 우하단 세로 2단 FAB(TRIP-709, d01 `ExploreLandingScreen` 패턴 복제): 위=담은 곳
            saved-menu 하트(펼치면 담은 장소→d02·저장한 숙소→e04 미니 FAB 이 왼쪽으로 나온다) ·
            아래=＋ 여행 만들기(→g01). `items-end` 로 둘 다 오른쪽 정렬. 열리면 배후 backdrop 딤. */}
        {savedMenu.open ? (
          <Pressable
            testID="destination-detail-saved-menu-backdrop"
            accessibilityRole="button"
            accessibilityLabel="담은 곳 메뉴 닫기"
            onPress={savedMenu.onToggle}
            className="absolute inset-0 bg-scrim/40"
          />
        ) : null}
        <View className="absolute bottom-[84px] right-lg items-end gap-md">
          <View className="flex-row items-center gap-md">
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
                  : `담은 장소 ${savedMenu.savedCount}곳`
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
          {/* ＋ 여행 만들기 — 하트 아래(핑크 원·흰 ＋). press 는 옵셔널 가드(미지정 no-op). */}
          <Pressable
            testID="destination-detail-create-trip-fab"
            accessibilityRole="button"
            accessibilityLabel="여행 만들기"
            onPress={() => onPressCreateTrip?.()}
            style={FAB_SHADOW}
            className="h-[56px] w-[56px] items-center justify-center rounded-full bg-primary"
          >
            <PlusGlyph size={26} />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
