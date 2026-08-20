/**
 * d01 탐색 랜딩 화면 — 순수 프레젠테이션(US-EXPL-01 · BR-U1-05/09/12/14/15 · Figma d01/1672:1183).
 *
 * 이 파일은 `features/explore` 라 `placeExploreStructure.test.ts` 의 재귀 스캔에 자동 편입돼
 * `@/features/stay` import·훅·zustand·`duration`·URL 리터럴을 0건으로 강제받는다 — 그래서
 * 조회·`formatPrice`/`stayKey` 조합은 이 화면이 아니라 라우트(`(tabs)/explore.tsx`)가 진다.
 * 화면은 뷰모델(prop)만 받는다.
 *
 * 5구획(위→아래): 헤딩 · 검색 · 숙소 가로 레인(카드 우상단 저장 하트) · 여행자 일정
 * 자리(준비 중) · 하단 bridgeBar(담은 곳 N곳 CTA — 담은 곳 d02 로, 0곳이어도 유지). 여행자 일정은 1차엔 자리만
 * (BR-U1-05), 장소·'내 주변'은 스코프 밖이라 렌더하지 않는다(TRIP-447로 축 4탭 제거).
 *
 * bridgeBar 는 탭바(오버레이) 위에 뜨는 고정 도크다 — 탭바 높이(84)만큼 위로 띄우고, 스크롤
 * 콘텐츠 하단 여백도 그만큼 확보해 마지막 항목이 안 가리게 한다(A7, `tabbarOverlay.test.ts`
 * AC-O3). 탭바는 SafeArea 를 모르는 순수 뷰라 하단 여백은 콘텐츠(이 화면) 쪽에 둔다(repo-trap).
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  HeartFilledGlyph,
  HeartOutlineGlyph,
  InfoGlyph,
  SearchGlyph,
  WarningTriangleGlyph,
} from '@/features/explore/ui/ExploreGlyphs';

export interface StayCardVM {
  key: string;
  name: string;
  region: string;
  priceText: string;
}

export interface ExploreLandingScreenProps {
  heading: { title: string; subtitle: string };
  /** 검색창 탭 — 입력 불가 진입 버튼이다. 실제 검색은 /explore/region 에서만 한다(TRIP-412).
   * 제출이 아니라 진입이므로 텍스트를 넘기지 않는다(자유 문자열이 region 으로 새는 걸 막는다). */
  onPressSearch: () => void;
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
  /** 하단 bridge CTA. 담은 곳이 0곳이어도 CTA 는 유지된다(TRIP-448) — 0곳 분기로 CTA 를
   * 없애면 d02 빈 상태에 도달할 경로가 사라진다. `onPressCreateTrip` 은 역사적 이름이고,
   * TRIP-448 이후 목적지는 위저드가 아니라 담은 곳(d02)이다(라우트가 목적지를 정한다). */
  bridge: { savedCount: number; onPressCreateTrip: () => void };
}

// 탭바(h-[84px]) 오버레이 위로 bridgeBar 를 띄우는 기준값. 스크롤 하단 여백도 이 위에 얹는다.
const TAB_BAR_CLEARANCE = 84;

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
  stayLane,
  bridge,
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

          {/* 검색 — 입력 불가 진입 버튼(TRIP-412). 탭하면 /explore/region 으로 간다. */}
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

          {/* 가볼 곳 — d04 장소 목록 진입점(최소 링크, 조회 없음 · TRIP-453 entry 2). 정본
              4구획의 "가볼 곳" 자리이나 1차엔 레인이 아니라 진입 링크 하나만 둔다(레인 복원은
              별도 화면 티켓). 항상 렌더되고, 탭하면 라우트가 /explore/places 로 push 한다. */}
          <View testID="explore-lane-place" className="mt-2xl">
            <LaneHeader title="가볼 곳" />
            <Pressable
              testID="explore-lane-place-cta"
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

        {/* bridgeBar — 탭바 위 고정 도크. 담은 곳(d02)으로 가는 CTA 는 담은 곳이 0곳이어도
            유지된다(TRIP-448). 0곳이면 d02 의 빈 상태로 간다 — 그 경로가 이 CTA 뿐이다. */}
        <View
          className="absolute inset-x-0 px-lg"
          style={{ bottom: TAB_BAR_CLEARANCE }}
        >
          <Pressable
            testID="explore-bridge-cta"
            accessibilityRole="button"
            onPress={bridge.onPressCreateTrip}
            className="h-14 flex-row items-center justify-center gap-sm rounded-pill bg-primary px-lg"
          >
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              ♥
            </Text>
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              담은 곳 {bridge.savedCount}곳
            </Text>
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              ›
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
