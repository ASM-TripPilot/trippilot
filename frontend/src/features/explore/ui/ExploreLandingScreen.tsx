/**
 * d01 탐색 랜딩 화면 — 순수 프레젠테이션(US-EXPL-01 · BR-U1-05/09/12/14/15 · Figma d01/1672:1183).
 *
 * 이 파일은 `features/explore` 라 `placeExploreStructure.test.ts` 의 재귀 스캔에 자동 편입돼
 * `@/features/stay` import·훅·zustand·`duration`·URL 리터럴을 0건으로 강제받는다 — 그래서
 * 조회·`formatPrice`/`stayKey` 조합은 이 화면이 아니라 라우트(`(tabs)/explore.tsx`)가 진다.
 * 화면은 뷰모델(prop)만 받는다.
 *
 * 5구획(위→아래): 헤딩 · 검색 · 숙소 가로 레인(카드 우상단 저장 하트) · 장소 가로 레인
 * (TRIP-470 복원) · 우하단 세로 2단 FAB. 여행자 일정 레인은 TRIP-703 으로 제거했다(라이브
 * Figma 1672:1183 에 없음). 축 4탭·'지금 내 주변'도 복원하지 않는다 — 죽은 탭(TRIP-447)·삭제된
 * 인프라(TRIP-445) 결정 유지.
 *
 * 우하단 FAB 은 세로 2단이다(TRIP-703): 위=담은 곳 saved-menu 하트(TRIP-494 — 누르면 담은
 * 장소→d02 · 저장한 숙소→e04 두 미니 FAB 으로 펼쳐진다) · 아래=＋ 여행 만들기(→g01, 라우트가
 * onPressCreateTrip 을 배선). FAB 은 탭바(오버레이) 위에 뜨는 고정 요소다(bottom-[100px]).
 * 스크롤 콘텐츠 하단 여백을 넉넉히 둬 마지막 항목이 안 가리게 한다. 탭바는 SafeArea 를 모르는
 * 순수 뷰다(repo-trap).
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PlaceCardVM } from '@/entities/place/model';
import { PlaceRailCard } from '@/entities/place/ui/PlaceRailCard';
import type { StayCardVM } from '@/entities/stay/model';
import { StaySearchCard } from '@/entities/stay/ui/StaySearchCard';
import { HeartFilledGlyph } from '@/shared/ui/HeartGlyphs';

import {
  CloseGlyph,
  InfoGlyph,
  MapPinGlyph,
  PlusGlyph,
  SearchGlyph,
  SuitcaseGlyph,
  WarningTriangleGlyph,
} from '@/features/explore/ui/ExploreGlyphs';

// 카드 뷰모델은 entities 로 이관됐다(StayCardVM=807 · PlaceCardVM=806) — 여기서 재수출해 기존
// 소비처(DestinationDetailScreen·placePhoto 테스트·라우트)의 `./ExploreLandingScreen`·이 파일 경유
// import 를 그대로 살린다(★11 — 로컬 export interface 제거가 진짜 이동 증거).
export type { PlaceCardVM, StayCardVM };

export interface ExploreLandingScreenProps {
  heading: { title: string; subtitle: string };
  /** 검색창 탭 — 입력 불가 진입 버튼이다. 실제 검색은 통합검색 /explore/search 에서 한다
   * (TRIP-450 으로 /explore/region 에서 되돌림 — 목적지는 소비 라우트가 정한다).
   * 제출이 아니라 진입이므로 텍스트를 넘기지 않는다(자유 문자열이 region 으로 새는 걸 막는다). */
  onPressSearch: () => void;
  /** 가볼 곳 가로 레인(TRIP-470) — 장소 카드 목록. 미지정/빈 목록이면 진입 링크(fallback)만
   * 보여준다(로딩·데이터 없음 안전). 카드 press 는 d06(/explore/places/{poiId})로. */
  placeLane?: {
    error: boolean;
    cards: PlaceCardVM[];
    onRetry: () => void;
    onPressCard: (poiId: string) => void;
  };
  /** "가볼 곳" 진입점 탭 → d04 장소 목록(/explore/places, TRIP-453). **옵셔널** — 기존
   * 소비처(cardPress 테스트·_dev/preview·save-integration)가 이 prop 없이 렌더하므로 필수화하면
   * tsc 가 그 세 곳에서 깨진다. 미지정 시 CTA 는 렌더되되 무동작(무회귀). 라우팅은 라우트가 진다. */
  onPressPlaces?: () => void;
  /** ＋ 여행 만들기 FAB(우하단, 담은 곳 하트 아래) → g01 위저드(/trips/new/step1, TRIP-703).
   * **옵셔널** — cardPress·placePhoto 테스트·_dev/preview 가 이 prop 없이 렌더하므로 필수화하면
   * 그 세 곳에서 tsc 가 깨진다. FAB 은 항상 렌더하되 press 는 `onPressCreateTrip?.()` 로 가드
   * (미지정 시 no-op·무회귀). 목적지 배선은 라우터를 아는 라우트가 진다(화면은 순수 뷰). */
  onPressCreateTrip?: () => void;
  /** 조회 대기 얼굴(TRIP-704, Figma 3612:2006) — 켜지면 숙소 2·장소 3 스켈레톤만 그리고 실카드·
   * 폴백·FAB 을 안 그린다. **옵셔널**(기본 false) — 미지정 시 기존 default 얼굴 그대로라 기존
   * 테스트가 무수정 green(무회귀). 배선은 라우트가 `stay.isPending || places.isPending` 로 내린다. */
  isLoading?: boolean;
  stayLane: {
    error: boolean;
    cards: StayCardVM[];
    onRetry: () => void;
    onSeeAll: () => void;
    // 저장 하트(TRIP-447) — 전부 additive·안전 기본값(미지정 시 빈 하트·무동작=무회귀).
    // 담김/미담김은 fill 색이 아니라 서로 다른 글리프 컴포넌트+testID 로 관찰한다(repo-trap
    // 글리프 함정 회피). 배선(useSavedStays·pendingKeys·saveError)은 라우트가 진다 — 화면은
    // `@/features/stay` import 금지라 훅을 직접 못 부른다(맹점 2).
    savedKeys?: string[];
    pendingKeys?: string[];
    onToggleSave?: (card: StayCardVM) => void;
    saveError?: boolean;
    onDismissSaveError?: () => void;
    // 카드 탭(TRIP-457 AC-6) — 눌린 card VM 을 그대로 올린다. 라우트가 key 로 원본 item 을
    // 역조회해 상세 push 한다(onToggleSave 선례). 하트 press 는 카드 push 를 안 삼킨다(★F-4).
    onPressCard?: (card: StayCardVM) => void;
  };
  /** 담은 곳 saved-menu FAB(우하단, Figma a01 3012:1731). 하트 FAB 을 누르면 두 미니 FAB
   * (담은 장소→d02 · 저장한 숙소→e04)으로 펼쳐지고, 열린 상태에선 하트가 X(닫기)로 바뀐다.
   * 열림 상태·라우팅은 순수 화면이 못 지므로 라우트가 소유해 prop 으로 내린다(구조 가드 —
   * 화면 useState 0건). 개수는 접근성 라벨로만 알린다. */
  savedMenu: {
    open: boolean;
    savedCount: number;
    onToggle: () => void;
    onPressSavedPlaces: () => void;
    onPressSavedStays: () => void;
  };
}

// 담은 곳 FAB 그림자(홈 SavedPlacesFab 선례) — RN 은 box-shadow 가 없어 style prop 으로 옮긴다.
// shadowColor '#000000' 은 토큰화 대상이 아니라 raw-hex 가드 사정거리 밖이다(홈 fabShadow 선례).
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
  onSeeAll?: () => void;
  seeAllTestID?: string;
}): ReactElement {
  return (
    <View className="mb-md flex-row items-center justify-between">
      <Text className="font-noto-bold text-section font-bold text-ink">
        {title}
      </Text>
      {onSeeAll && seeAllTestID ? (
        <Pressable
          testID={seeAllTestID}
          accessibilityRole="button"
          onPress={onSeeAll}
          className="flex-row items-center gap-xs"
        >
          <Text className="font-noto text-label text-muted">모두 보기</Text>
          <Text className="font-noto text-label text-muted">›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function StayLaneError({ onRetry }: { onRetry: () => void }): ReactElement {
  // 부분 실패 — 침묵하지 않고 자리에 재시도를 띄운다(US-EXPL-01 · INV-4). 나머지 구획은 산다.
  return (
    <View className="items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl">
      <WarningTriangleGlyph size={28} tone="primary" />
      <Text className="font-noto text-label text-muted">
        숙소를 불러오지 못했어요
      </Text>
      <Pressable
        testID="explore-lane-stay-retry"
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

function SkeletonRail({
  testIDPrefix,
  count,
  width,
  height,
}: {
  testIDPrefix: string;
  count: number;
  width: number;
  height: number;
}): ReactElement {
  // 조회 대기 자리표시 — 회색 라운드 박스를 가로로 나열한다(TRIP-704). 카드 자리 크기를 그대로
  // 잡아 도착 시 레이아웃이 안 튄다. testID 로 개수를 세어 잠근다(스켈레톤은 텍스트가 없다).
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View className="flex-row gap-md">
        {Array.from({ length: count }).map((_, i) => (
          <View
            key={i}
            testID={`${testIDPrefix}-${i}`}
            className="rounded-card bg-surface-soft"
            style={{ width, height }}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function StaySaveErrorBanner({
  onDismiss,
}: {
  onDismiss?: () => void;
}): ReactElement {
  // 담기 실패를 침묵하지 않고 알린다(INV-4). 숙소 전용 일반 문구 — 장소 문구(SAVE_FAILURE_NOTICE)
  // 를 재사용하면 "장소"가 노출된다(Seed Q4). 탭하면 배너가 닫힌다(다음 하트 press 로도 소멸).
  return (
    <Pressable
      testID="explore-stay-save-error"
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

export function ExploreLandingScreen({
  heading,
  onPressSearch,
  onPressPlaces,
  onPressCreateTrip,
  isLoading = false,
  placeLane,
  stayLane,
  savedMenu,
}: ExploreLandingScreenProps): ReactElement {
  const {
    savedKeys = [],
    pendingKeys = [],
    onToggleSave,
    onPressCard,
    saveError = false,
    onDismissSaveError,
  } = stayLane;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="explore-landing" className="flex-1 bg-canvas">
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingTop: 12,
            paddingHorizontal: 16,
            paddingBottom: 156,
          }}
        >
          {/* 헤딩 */}
          <View testID="explore-landing-heading">
            <Text className="font-noto-bold text-hero font-bold text-ink">
              {heading.title}
            </Text>
            <Text className="mt-xs font-noto text-label text-muted">
              {heading.subtitle}
            </Text>
          </View>

          {/* 검색 — 입력 불가 진입 버튼. 탭하면 통합검색 /explore/search 로 간다(TRIP-450). */}
          <Pressable
            testID="explore-landing-search"
            accessibilityRole="button"
            onPress={onPressSearch}
            className="mt-lg h-[58px] flex-row items-center gap-sm rounded-pill border border-hairline-strong bg-canvas px-lg"
          >
            <SearchGlyph size={20} />
            <Text className="flex-1 font-noto text-body text-muted-soft">
              도시 · 장소 · 숙소 검색
            </Text>
          </Pressable>

          {/* 숙소 가로 레인 */}
          <View testID="explore-lane-stay" className="mt-2xl">
            <LaneHeader
              title="숙소"
              onSeeAll={stayLane.onSeeAll}
              seeAllTestID="explore-lane-stay-seeall"
            />
            {!isLoading && saveError ? (
              <StaySaveErrorBanner onDismiss={onDismissSaveError} />
            ) : null}
            {isLoading ? (
              <SkeletonRail
                testIDPrefix="explore-landing-skeleton-stay"
                count={2}
                width={200}
                height={190}
              />
            ) : stayLane.error ? (
              <StayLaneError onRetry={stayLane.onRetry} />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-md">
                  {stayLane.cards.map((card) => (
                    // rail 카드 — 하트는 카드가 소유(save 계약). 담김/미담김은 색이 아니라 서로 다른
                    // 글리프 testID + selected 로 관측한다(★5). 사진은 회색 자리(URL 계약 무 · INV-1).
                    <StaySearchCard
                      key={card.key}
                      testID={`explore-stay-card-${card.key}`}
                      name={card.name}
                      region={card.region}
                      priceText={card.priceText}
                      variant="rail"
                      save={{
                        saved: savedKeys.includes(card.key),
                        pending: pendingKeys.includes(card.key),
                        onToggle: () => onToggleSave?.(card),
                        testID: `explore-stay-save-${card.key}`,
                        filledTestID: `explore-stay-heart-filled-${card.key}`,
                        outlineTestID: `explore-stay-heart-outline-${card.key}`,
                      }}
                      onPress={() => onPressCard?.(card)}
                    />
                  ))}
                </View>
              </ScrollView>
            )}
          </View>

          {/* 가볼 곳 — 장소 가로 레인(TRIP-470 레인 복원, 453 진입 링크는 로딩·빈 목록 fallback).
              헤더 "모두 보기"(explore-lane-place-cta)는 d04(/explore/places)로, 카드 press 는
              d06(/explore/places/{poiId})로. 세그·'지금 내 주변'은 복원하지 않는다(각각 죽은 탭·
              삭제된 인프라 — TRIP-447/445 결정 유지). */}
          <View testID="explore-lane-place" className="mt-2xl">
            <LaneHeader
              title="장소"
              onSeeAll={onPressPlaces}
              seeAllTestID="explore-lane-place-cta"
            />
            {isLoading ? (
              <SkeletonRail
                testIDPrefix="explore-landing-skeleton-place"
                count={3}
                width={150}
                height={150}
              />
            ) : placeLane?.error ? (
              <Pressable
                testID="explore-lane-place-retry"
                accessibilityRole="button"
                onPress={placeLane.onRetry}
                className="flex-row items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl"
              >
                <InfoGlyph size={18} />
                <Text className="flex-1 font-noto text-label text-muted">
                  장소를 불러오지 못했어요 · 다시 시도
                </Text>
              </Pressable>
            ) : placeLane && placeLane.cards.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-md">
                  {placeLane.cards.map((card) => (
                    <PlaceRailCard
                      key={card.poiId}
                      card={card}
                      onPress={placeLane.onPressCard}
                    />
                  ))}
                </View>
              </ScrollView>
            ) : (
              <Pressable
                testID="explore-lane-place-empty"
                accessibilityRole="button"
                onPress={onPressPlaces}
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

        {/* 담은 곳 saved-menu FAB — 우하단 하트 FAB 을 누르면 두 미니 FAB 으로 펼쳐진다(Figma
            a01 3012:1731). 왼→오: 담은 장소(위치핀→d02) · 저장한 숙소(가방→e04) · 하트/닫기.
            열리면 배후 backdrop 이 뜨고, 바깥 탭으로 닫힌다. 풀폭 핑크 CTA 바에서 교체(TRIP-494).
            열림 상태는 라우트 소유(화면 useState 0건 구조 가드). */}
        {!isLoading && savedMenu.open ? (
          <Pressable
            testID="explore-saved-menu-backdrop"
            accessibilityRole="button"
            accessibilityLabel="담은 곳 메뉴 닫기"
            onPress={savedMenu.onToggle}
            className="absolute inset-0 bg-scrim/40"
          />
        ) : null}
        {/* 우하단 세로 2단 FAB(TRIP-703): 위 행=하트 saved-menu(펼치면 미니 FAB 이 왼쪽으로
            나온다) · 아래=＋ 여행 만들기. items-end 로 둘 다 오른쪽에 정렬한다. 로딩 중엔 조작
            대상이 없어 통째로 미렌더한다(TRIP-704). */}
        {isLoading ? null : (
          <View className="absolute bottom-[100px] right-lg items-end gap-md">
            <View className="flex-row items-center gap-md">
              {savedMenu.open ? (
                <>
                  <Pressable
                    testID="explore-saved-places-fab"
                    accessibilityRole="button"
                    accessibilityLabel={`담은 장소 ${savedMenu.savedCount}곳`}
                    onPress={savedMenu.onPressSavedPlaces}
                    style={FAB_SHADOW}
                    className="h-[56px] w-[56px] items-center justify-center rounded-full bg-canvas"
                  >
                    <MapPinGlyph size={26} tone="primary" />
                  </Pressable>
                  <Pressable
                    testID="explore-saved-stays-fab"
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
                testID="explore-saved-menu-toggle"
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
            {/* ＋ 여행 만들기 — 하트 아래(핑크 원·흰 ＋). press 는 옵셔널 가드(미지정 no-op). */}
            <Pressable
              testID="explore-create-trip-fab"
              accessibilityRole="button"
              accessibilityLabel="여행 만들기"
              onPress={() => onPressCreateTrip?.()}
              style={FAB_SHADOW}
              className="h-[56px] w-[56px] items-center justify-center rounded-full bg-primary"
            >
              <PlusGlyph size={26} />
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
