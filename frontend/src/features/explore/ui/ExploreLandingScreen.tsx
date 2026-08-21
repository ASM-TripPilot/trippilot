/**
 * d01 탐색 랜딩 화면 — 순수 프레젠테이션(US-EXPL-01 · BR-U1-05/09/12/14/15 · Figma d01/1672:1183).
 *
 * 이 파일은 `features/explore` 라 `placeExploreStructure.test.ts` 의 재귀 스캔에 자동 편입돼
 * `@/features/stay` import·훅·zustand·`duration`·URL 리터럴을 0건으로 강제받는다 — 그래서
 * 조회·`formatPrice`/`stayKey` 조합은 이 화면이 아니라 라우트(`(tabs)/explore.tsx`)가 진다.
 * 화면은 뷰모델(prop)만 받는다.
 *
 * 6구획(위→아래): 헤딩 · 검색 · 숙소 가로 레인(카드 우상단 저장 하트) · 가볼 곳 가로 레인
 * (장소 카드, TRIP-470 복원) · 여행자 일정 자리(준비 중) · 우하단 담은 곳 saved-menu FAB
 * (TRIP-494 — 하트 FAB 을 누르면 담은 장소→d02 · 저장한 숙소→e04 두 미니 FAB 으로 펼쳐진다).
 * 여행자 일정은 1차엔 자리만(BR-U1-05). 축 4탭(전체·숙소·장소·여행자)·'지금 내 주변'은
 * 복원하지 않는다 — 죽은 탭(TRIP-447)·삭제된 인프라(TRIP-445) 결정 유지.
 *
 * FAB 은 탭바(오버레이) 위에 뜨는 고정 요소다(bottom-[100px]). 스크롤 콘텐츠 하단 여백을
 * 넉넉히 둬 마지막 항목이 안 가리게 한다. 탭바는 SafeArea 를 모르는 순수 뷰다(repo-trap).
 */
import type { ReactElement } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CloseGlyph,
  HeartFilledGlyph,
  HeartOutlineGlyph,
  InfoGlyph,
  MapPinGlyph,
  SearchGlyph,
  SuitcaseGlyph,
  WarningTriangleGlyph,
} from '@/features/explore/ui/ExploreGlyphs';

export interface StayCardVM {
  key: string;
  name: string;
  region: string;
  priceText: string;
}

/** 가볼 곳 레인 카드(TRIP-470) — 이름·지역 + 사진(TRIP-496, `Place.imageUrl` 계약에 존재).
 *  저장 하트는 여전히 스코프 밖. `imageUrl` 은 옵셔널(없으면 회색 플레이스홀더, 지어내지 않음·INV-1). */
export interface PlaceCardVM {
  poiId: string;
  name: string;
  region: string;
  imageUrl?: string | null;
}

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

function StayCard({
  card,
  saved,
  pending,
  onToggleSave,
  onPressCard,
}: {
  card: StayCardVM;
  saved: boolean;
  pending: boolean;
  onToggleSave?: (card: StayCardVM) => void;
  onPressCard?: (card: StayCardVM) => void;
}): ReactElement {
  // 사진은 계약(StayItem)에 URL 필드가 없어 회색 자리(surface-strong)로 둔다 — URL 을
  // 지어내지 않는다(INV-1). 메타는 이름·지역·최저가뿐: 거리·소요시간 데이터가 없다(INV-3).
  // 사진 우상단에 저장 하트(흰 원+하트, d04 PlaceCard 선례) — 담김/미담김을 서로 다른 글리프
  // 로 그려 색 토글이 아니라 testID 로 관찰되게 한다. 대기 중(pending)이면 disabled 라 재누름이
  // onPress 를 안 부른다(연타 가드). 카드 루트는 Pressable — 하트 press 는 findEventHandler가
  // 하트에서 멈춰 카드 push 를 삼키지 않는다(★F-4).
  return (
    <Pressable
      testID={`explore-stay-card-${card.key}`}
      accessibilityRole="button"
      onPress={() => onPressCard?.(card)}
      className="w-[200px]"
    >
      <View className="h-[130px] w-full rounded-card bg-surface-strong">
        <Pressable
          testID={`explore-stay-save-${card.key}`}
          accessibilityRole="button"
          accessibilityState={{ selected: saved }}
          disabled={pending}
          onPress={() => onToggleSave?.(card)}
          className="absolute right-sm top-sm h-8 w-8 items-center justify-center rounded-pill bg-on-primary"
        >
          {saved ? (
            <HeartFilledGlyph
              testID={`explore-stay-heart-filled-${card.key}`}
              size={18}
            />
          ) : (
            <HeartOutlineGlyph
              testID={`explore-stay-heart-outline-${card.key}`}
              size={18}
            />
          )}
        </Pressable>
      </View>
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

// 가볼 곳 레인 카드(TRIP-470) — 사진 + 이름·지역. 저장 하트·가격 없음(스코프 밖). 카드 press → d06 상세.
// 사진은 `imageUrl` 이 있을 때만 그린다 — 없으면 회색 플레이스홀더(기본 이미지 발명 금지·INV-1, TRIP-496).
function PlaceCard({
  card,
  onPress,
}: {
  card: PlaceCardVM;
  onPress: (poiId: string) => void;
}): ReactElement {
  return (
    <Pressable
      testID={`explore-place-card-${card.poiId}`}
      accessibilityRole="button"
      onPress={() => onPress(card.poiId)}
      className="w-[160px]"
    >
      {card.imageUrl ? (
        <Image
          testID={`explore-place-card-image-${card.poiId}`}
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
            className="mt-lg h-[52px] flex-row items-center gap-sm rounded-pill border border-hairline-strong bg-canvas px-lg"
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
            {saveError ? (
              <StaySaveErrorBanner onDismiss={onDismissSaveError} />
            ) : null}
            {stayLane.error ? (
              <StayLaneError onRetry={stayLane.onRetry} />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-md">
                  {stayLane.cards.map((card) => (
                    <StayCard
                      key={card.key}
                      card={card}
                      saved={savedKeys.includes(card.key)}
                      pending={pendingKeys.includes(card.key)}
                      onToggleSave={onToggleSave}
                      onPressCard={onPressCard}
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
              title="가볼 곳"
              onSeeAll={onPressPlaces}
              seeAllTestID="explore-lane-place-cta"
            />
            {placeLane?.error ? (
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

          {/* 여행자 일정 — 자리만(BR-U1-05) */}
          <View testID="explore-lane-itin" className="mt-2xl">
            <LaneHeader title="여행자 일정" />
            <View className="flex-row items-center gap-sm rounded-card bg-surface-soft px-lg py-2xl">
              <InfoGlyph size={18} />
              <Text className="font-noto text-label text-muted">
                여행자들의 일정을 준비 중이에요
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* 담은 곳 saved-menu FAB — 우하단 하트 FAB 을 누르면 두 미니 FAB 으로 펼쳐진다(Figma
            a01 3012:1731). 왼→오: 담은 장소(위치핀→d02) · 저장한 숙소(가방→e04) · 하트/닫기.
            열리면 배후 backdrop 이 뜨고, 바깥 탭으로 닫힌다. 풀폭 핑크 CTA 바에서 교체(TRIP-494).
            열림 상태는 라우트 소유(화면 useState 0건 구조 가드). */}
        {savedMenu.open ? (
          <Pressable
            testID="explore-saved-menu-backdrop"
            accessibilityRole="button"
            accessibilityLabel="담은 곳 메뉴 닫기"
            onPress={savedMenu.onToggle}
            className="absolute inset-0"
          />
        ) : null}
        <View className="absolute bottom-[100px] right-lg flex-row items-center gap-md">
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
      </View>
    </SafeAreaView>
  );
}
