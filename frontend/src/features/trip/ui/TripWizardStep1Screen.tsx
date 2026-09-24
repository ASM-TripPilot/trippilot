import type { ReactElement, ReactNode } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { MustVisitSeedItem } from '../model/mustVisitSeed';
import { formatWizardStep } from '../model/tripSummary';
import type { PreferenceSummary, SummaryLine } from '../model/tripSummary';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  ChevronRightGlyph,
  GlobeGlyph,
  PlusGlyph,
  SparkleGlyph,
} from './TripGlyphs';

/**
 * TRIP-665 g01 '여행 만들기' default 재작성 — **props만 받는 프레젠테이션 화면**(Figma `3742:2068`).
 *
 * 무엇을 보장하나: 신 default 골격 — 앱바(back + 세그먼트 진행바 4칸 + "1 / 4") · 타이틀/부제 ·
 * **온보딩 요약 카드 5행**(여행지→기간→동행→취향→예산, 각 값 or muted 플레이스홀더 + chevron,
 * 탭하면 편집 시트 오픈 콜백) · **꼭 갈 곳 가로 스트립**(더 담기 + 전체 보기 + 담은 곳 카드) ·
 * 하단 [다음](받은 `canProceed` 하나로만 갈림). 실패 표면(제출/등록 배너·국내 차단 다이얼로그)은
 * 완성된 문자열/불리언을 받았을 때만 그린다 — 화면은 판정하지 않는다.
 *
 * 왜 이 설계인가: 옛 default 는 인라인 전개 폼(프리셋·스테퍼·칩·예산 입력·날짜 카드·등록숙소
 * 행·여행지 시트)이었고, 신 default 는 **온보딩 반영 요약 + 편집 시트 오픈 신호까지**다(편집 시트
 * 본체는 S2~S6 후속). 요약 5행 값은 페이지가 `tripSummary` 셀렉터로 도출한 **완성형 문자열**로
 * 내려온다 — 화면은 문자열을 조립하지 않는다(값이 `null`이면 미선택이라 플레이스홀더를 그린다).
 *
 * 왜 props만 받는가: 이 화면이 쿼리 훅·라우터·`expo-location`을 전이 의존으로라도 물면 dev
 * 프리뷰가 터지고 테스트가 네트워크에 묶인다 — 그 제약은 렌더로 관찰할 수 없어
 * `src/__tests__/tripWizardStep1Boundary.test.ts`가 소스 층에서 잠근다(AC-7). 진행 표시 "1 / 4"는
 * 화면이 `formatWizardStep(1)`을 직접 소비한다 — 이 import 가 boundary 전이 그래프에
 * `tripWizardStep1.ts`를 살려 두는 앵커이기도 하다(하드코딩·페이지 계산 prop 이면 boundary red).
 *
 * 커버하지 않는 것: 요약 문자열 **도출**(페이지 `tripSummary` 셀렉터 배선) · 편집 시트 본체(S2~S6) ·
 * 스트립 카드의 지역명(`MustVisitSeedItem`에 region 필드가 없어 이름만 그린다, D3) · 픽셀 충실도([검증]).
 */

export interface TripWizardStep1ScreenProps {
  /** 요약 5행 — 페이지가 `tripSummary` 셀렉터로 도출한 2톤 객체(`{main; sub?}`). `null` = 미선택
   * (플레이스홀더). 취향만 `{main; onboarding}`(온보딩 배지용). TRIP-732: 문자열 → 객체. */
  summaryDestinations: SummaryLine | null;
  summaryPeriod: SummaryLine | null;
  summaryCompanion: SummaryLine | null;
  summaryPreferences: PreferenceSummary | null;
  summaryBudget: SummaryLine | null;
  /** 각 요약 행 탭 → 해당 필드 편집 시트 오픈(S2~S6 스텁). 화면은 신호만 위로 올린다. */
  onPressSummaryDestination(): void;
  onPressSummaryPeriod(): void;
  onPressSummaryCompanion(): void;
  onPressSummaryPreference(): void;
  onPressSummaryBudget(): void;

  /** 꼭 갈 곳 스트립 — 담은 곳 시드(0곳도 스트립을 감추지 않는다, empty 일러스트는 S7). */
  mustVisits: MustVisitSeedItem[];
  /** 더 담기(첫 위치) — 담은 장소/탐색으로 보낸다(목적지 분기는 페이지). */
  onPressMore(): void;
  /** 전체 보기 → S12 스텁 라우트. */
  onPressSeeAll(): void;

  /** `[다음]` 활성 판정 **결과**만 받는다. */
  canProceed: boolean;
  onNext(): void;
  onBack(): void;

  /** loading 얼굴(TRIP-671 D4) — `true` 면 요약 5행·꼭 갈 곳을 스켈레톤으로 갈고, 부제를 로딩 문구로
   * 바꾸고, `canProceed` 가 참이어도 `[다음]`을 강제 비활성한다. 미지정/`false` 면 default·empty(현행).
   * additive optional 이라 기존 호출부·동결 테스트 무회귀. */
  isLoading?: boolean;

  /** 제출 실패 배너 본문(완성형). 제목·버튼 라벨은 Figma 고정 문구라 화면이 갖는다. */
  submitError?: string;
  onRetrySubmit?(): void;
  /** 등록 실패 배너 본문(완성형) — 제출 실패 배너와 자리는 같지만 testID 가 다르다(01b D2 —
   * 합치면 [다시 시도]가 여행을 하나 더 만든다). */
  mustVisitError?: string;
  onRetryMustVisits?(): void;

  /** 국내 밖 차단 다이얼로그 노출 여부(BR-U1-35). */
  overseasBlocked?: boolean;
  onCloseOverseasDialog?(): void;
  /** '국내 도시 고르기' → 여행지 편집 시트 오픈 콜백으로 재배선(D6). 옛 인라인 도시 시트는 없다. */
  onPickDomesticRegion?(): void;
}

/** 요약 카드 그림자 — Figma `0 2 10 rgba(0,0,0,.06)`. 그림자는 토큰 대상이 아니라 raw 가 맞다
 * (`HomeScreen.tsx`·옛 썸네일 제거 버튼 선례). */
const SUMMARY_CARD_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

/**
 * 요약 카드 한 행 — 라벨 + 값(2톤) 또는 플레이스홀더(없으면) + 우측 chevron. 행 전체가 Pressable
 * 이라 탭하면 편집 시트 오픈 콜백을 부른다(값 조립은 페이지 몫이라 화면은 받은 객체를 그대로 그린다).
 *
 * 2톤(TRIP-732): 값이 있으면 굵은 main + 같은 줄에 `sub`(있으면) 회색 caption(testID `{행}-sub`,
 * `text-muted`)을 그린다. sub 가 없는 행(동행)은 caption 요소 자체를 안 만든다. 취향 행은 sub 대신
 * `trailing`(스파클+온보딩 배지)을 main 뒤에 얹는다.
 *
 * 플레이스홀더는 **행별**이다(TRIP-671 D1): 여행지 null → "어디로 갈까요?"(진한 값 톤), 기간 null →
 * 값 줄 자체 없음(`placeholder=null`), 나머지 → muted "{라벨} 선택". `isLoading` 이면 값 자리를 회색
 * 스켈레톤 바로 갈아 실값·플레이스홀더를 가린다(loading 얼굴).
 */
function SummaryRow({
  testID,
  label,
  value,
  placeholder,
  placeholderTone,
  onPress,
  isLoading,
  skeletonTestID,
  skeletonWidths,
  trailing,
}: {
  testID: string;
  label: string;
  /** 2톤 값(`{main; sub?}`). `null` 이면 미선택(플레이스홀더). */
  value: SummaryLine | null;
  /** value 가 null 일 때 그릴 카피. `null` 이면 값 줄 자체를 안 그린다(기간 행). */
  placeholder: string | null;
  /** 플레이스홀더 색 톤 — 여행지만 'ink'(Figma empty 진한 값 톤), 나머지는 'muted'. */
  placeholderTone: 'ink' | 'muted';
  onPress(): void;
  /** loading 얼굴 — 값 자리에 회색 스켈레톤 바(라벨은 유지). */
  isLoading?: boolean;
  skeletonTestID: string;
  /** loading 스켈레톤 바 폭(px) 배열 — 배열 길이가 곧 바 개수다(행별로 다름, Figma 3712:2068 실측). */
  skeletonWidths: number[];
  /** main 뒤에 얹을 배지(취향 행 온보딩 스파클 전용, 나머지 행은 undefined). */
  trailing?: ReactNode;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-sm px-lg py-[13px]"
    >
      <View className="flex-1 gap-[6px]">
        <Text className="font-noto text-caption text-muted">{label}</Text>
        {isLoading ? (
          <View testID={skeletonTestID} className="flex-row gap-[6px]">
            {skeletonWidths.map((w, i) => (
              <View
                key={i}
                testID={`${skeletonTestID}-bar-${i}`}
                className={`h-[12px] rounded-[10px] bg-hairline w-[${w}px]`}
              />
            ))}
          </View>
        ) : value === null ? (
          placeholder === null ? null : (
            <Text
              className={
                placeholderTone === 'ink'
                  ? 'font-noto-bold text-card-title font-bold text-ink'
                  : 'font-noto text-card-title text-muted'
              }
            >
              {placeholder}
            </Text>
          )
        ) : (
          <View className="flex-row items-center gap-[6px]">
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {value.main}
            </Text>
            {value.sub !== undefined ? (
              <Text
                testID={`${testID}-sub`}
                className="font-noto text-caption text-muted"
              >
                {value.sub}
              </Text>
            ) : null}
            {trailing}
          </View>
        )}
      </View>
      <ChevronRightGlyph size={20} tone="muted" />
    </Pressable>
  );
}

/**
 * 꼭 갈 곳 가로 스트립 — 헤더("꼭 갈 곳 {N}" + 전체 보기) + 스크롤 행([더 담기 첫 위치] + 담은
 * 곳 카드들). 카드는 이미지 자리 + 이름 + (region 있으면) 지역 한 줄이다(TRIP-685). 이미지는
 * `imageUrl` 이 있을 때만 그린다 — 없으면 회색 자리로 두고 기본 이미지를 지어내지 않는다(INV-1).
 * 0곳도 스트립을 감추지 않는다(empty 일러스트 얼굴은 S7).
 */
function MustVisitStrip({
  mustVisits,
  onPressMore,
  onPressSeeAll,
}: {
  mustVisits: MustVisitSeedItem[];
  onPressMore(): void;
  onPressSeeAll(): void;
}): ReactElement {
  return (
    <View testID="trip-wizard-mustvisit-block" className="gap-[10px]">
      <View className="flex-row items-center justify-between">
        <Text className="font-noto-bold text-section font-bold text-ink">
          {`꼭 갈 곳 `}
          <Text className="font-inter-bold font-bold text-ink">
            {mustVisits.length}
          </Text>
        </Text>
        {/* 전체 보기 — 담은 곳이 하나라도 있을 때만(TRIP-732 AC-7). 0곳이면 볼 목록이 없어 안 그린다. */}
        {mustVisits.length > 0 ? (
          <Pressable
            testID="trip-wizard-mustvisit-see-all"
            accessibilityRole="button"
            onPress={onPressSeeAll}
            className="flex-row items-center gap-[2px]"
            hitSlop={6}
          >
            <Text className="font-noto-bold text-label font-bold text-ink">
              전체 보기
            </Text>
            <ChevronRightGlyph size={16} tone="muted" />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10 }}
      >
        <Pressable
          testID="trip-wizard-mustvisit-more"
          accessibilityRole="button"
          onPress={onPressMore}
          className="h-[129px] w-[112px] items-center justify-center gap-[6px] rounded-[14px] border-[1.5px] border-dashed border-hairline-strong"
        >
          <PlusGlyph size={22} />
          <Text className="font-noto-bold text-label font-bold text-primary-text">
            더 담기
          </Text>
        </Pressable>
        {mustVisits.map((item) => (
          <View
            key={item.sourcePoiId}
            testID={`trip-wizard-mustvisit-${item.sourcePoiId}`}
            className="w-[112px] gap-[6px]"
          >
            <View className="h-[88px] w-[112px] overflow-hidden rounded-[14px] bg-surface-strong">
              {item.imageUrl === null ? null : (
                <Image
                  testID={`trip-wizard-mustvisit-image-${item.sourcePoiId}`}
                  source={{ uri: item.imageUrl }}
                  resizeMode="cover"
                  className="h-full w-full"
                />
              )}
            </View>
            <Text
              numberOfLines={1}
              className="font-noto-bold text-label font-bold text-ink"
            >
              {item.name}
            </Text>
            {item.region ? (
              <Text
                testID={`trip-wizard-mustvisit-region-${item.sourcePoiId}`}
                numberOfLines={1}
                className="font-noto text-caption text-muted"
              >
                {item.region}
              </Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * 꼭 갈 곳 로딩 스켈레톤(TRIP-671 loading 얼굴) — 헤더는 숫자 없는 "꼭 갈 곳" + 캡션, 스트립 자리에
 * 회색 카드 4장(점선 "+ 더 담기" 박스 없음). 카드는 단일 64×64 정사각(`bg-hairline`·`rounded-[10px]`,
 * 텍스트 바 없음, Figma 3712:2068 실측) — 색·크기·정렬은 jest 사각(6-b).
 */
function MustVisitSkeleton(): ReactElement {
  return (
    <View className="gap-[10px]">
      <View className="gap-[2px]">
        <Text className="font-noto-bold text-section font-bold text-ink">
          꼭 갈 곳
        </Text>
        <Text className="font-noto text-label text-muted">
          담아 둔 곳을 불러오는 중이에요
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {[1, 2, 3, 4].map((n) => (
          <View
            key={n}
            testID={`trip-wizard-mustvisit-skeleton-${n}`}
            className="h-[64px] w-[64px] rounded-[10px] bg-hairline"
          />
        ))}
      </ScrollView>
    </View>
  );
}

export function TripWizardStep1Screen({
  summaryDestinations,
  summaryPeriod,
  summaryCompanion,
  summaryPreferences,
  summaryBudget,
  onPressSummaryDestination,
  onPressSummaryPeriod,
  onPressSummaryCompanion,
  onPressSummaryPreference,
  onPressSummaryBudget,
  mustVisits,
  onPressMore,
  onPressSeeAll,
  canProceed,
  onNext,
  onBack,
  isLoading,
  submitError,
  onRetrySubmit,
  mustVisitError,
  onRetryMustVisits,
  overseasBlocked,
  onCloseOverseasDialog,
  onPickDomesticRegion,
}: TripWizardStep1ScreenProps): ReactElement {
  // loading 이면 게이트가 참이어도 [다음]을 막는다(TRIP-671 D4) — 화면이 isLoading 을 next 에 물린다.
  const nextDisabled = !canProceed || Boolean(isLoading);
  // empty 얼굴(Figma 3652) 판정 — 여행지·기간만 미선택이고 나머지(동행·취향·예산)는 프리필로 채워진
  // 상태. 다섯 행이 전부 null 인 퇴화 상태(프리필 미도착)는 "나머지는 채워둘게요" 문구가 거짓이라
  // empty 로 치지 않는다. 승인 테스트 두 축이 이 경계를 함께 고정한다(TRIP-732 AC-6): summary2tone
  // empty(여행지·기간 null + 3행 채움) → empty, test.tsx AC-1(전부 null) → default.
  const isEmptyFace =
    !isLoading &&
    summaryDestinations === null &&
    summaryPeriod === null &&
    (summaryCompanion !== null ||
      summaryPreferences !== null ||
      summaryBudget !== null);
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="trip-wizard-step1-root" className="flex-1 bg-canvas">
        {/* 앱바 — back + 제목 + 세그먼트 진행바 4칸 + "1 / 4" */}
        <View className="flex-row items-center gap-sm px-lg pb-sm pt-md">
          <Pressable
            testID="trip-wizard-step1-back"
            accessibilityRole="button"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="text-section font-noto-bold font-bold text-ink">
            여행 만들기
          </Text>
          <View className="flex-1" />
          <View className="flex-row items-center gap-xs">
            {[1, 2, 3, 4].map((n) => (
              <View
                key={n}
                testID={`trip-wizard-progress-seg-${n}`}
                className={`h-1 rounded-[2px] ${
                  n === 1
                    ? 'w-[20px] bg-primary'
                    : 'w-[14px] bg-hairline-strong'
                }`}
              />
            ))}
            <Text className="ml-[2px] font-inter-bold text-caption text-muted">
              {formatWizardStep(1)}
            </Text>
          </View>
        </View>

        <ScrollView className="flex-1">
          <View className="gap-xl px-lg pb-[20px] pt-md">
            {/* 타이틀 블록 */}
            <View className="gap-[6px]">
              <Text className="font-noto-bold text-display font-bold text-ink">
                어디로 떠날까요?
              </Text>
              {/* 부제 3분기(TRIP-732 AC-6, 우선순위 loading > empty > default): 로딩 중이면 로딩
                  문구, 아니면 empty 얼굴이면 empty 문구, 그 외 default(온보딩 반영). */}
              <Text className="font-noto text-label text-muted">
                {isLoading
                  ? '여행 정보를 불러오는 중이에요'
                  : isEmptyFace
                    ? '여행지와 기간만 정하면 나머지는 채워둘게요 · 행을 누르면 바꿀 수 있어요'
                    : '온보딩에서 고른 취향을 그대로 반영했어요 · 행을 누르면 바꿀 수 있어요'}
              </Text>
            </View>

            {/* 요약 카드 5행 (여행지→기간→동행→취향→예산) */}
            <View
              className="rounded-card border border-hairline bg-canvas"
              style={SUMMARY_CARD_SHADOW}
            >
              <SummaryRow
                testID="trip-wizard-summary-destination"
                label="여행지"
                value={summaryDestinations}
                placeholder="어디로 갈까요?"
                placeholderTone="ink"
                onPress={onPressSummaryDestination}
                isLoading={isLoading}
                skeletonTestID="trip-wizard-summary-skeleton-1"
                skeletonWidths={[56, 74]}
              />
              <View className="h-[1px] bg-hairline" />
              <SummaryRow
                testID="trip-wizard-summary-period"
                label="기간"
                value={summaryPeriod}
                placeholder={null}
                placeholderTone="muted"
                onPress={onPressSummaryPeriod}
                isLoading={isLoading}
                skeletonTestID="trip-wizard-summary-skeleton-2"
                skeletonWidths={[140, 40]}
              />
              <View className="h-[1px] bg-hairline" />
              <SummaryRow
                testID="trip-wizard-summary-companion"
                label="동행"
                value={summaryCompanion}
                placeholder="동행 선택"
                placeholderTone="muted"
                onPress={onPressSummaryCompanion}
                isLoading={isLoading}
                skeletonTestID="trip-wizard-summary-skeleton-3"
                skeletonWidths={[78]}
              />
              <View className="h-[1px] bg-hairline" />
              <SummaryRow
                testID="trip-wizard-summary-preference"
                label="취향"
                // 취향은 {main; onboarding} — main 만 value 로 넘기고, 온보딩 배지는 trailing 으로.
                value={
                  summaryPreferences === null
                    ? null
                    : { main: summaryPreferences.main }
                }
                placeholder="취향 선택"
                placeholderTone="muted"
                onPress={onPressSummaryPreference}
                isLoading={isLoading}
                skeletonTestID="trip-wizard-summary-skeleton-4"
                skeletonWidths={[110, 48]}
                trailing={
                  // 온보딩 상속일 때만 기존 SparkleGlyph + 분홍 "온보딩" 배지(옛 " + 온보딩" 문자열
                  // 대체, TRIP-732 AC-5). onboarding=false 면 배지 자체를 안 그린다.
                  summaryPreferences?.onboarding ? (
                    <View className="flex-row items-center gap-[3px]">
                      <SparkleGlyph
                        testID="trip-wizard-preference-sparkle"
                        size={14}
                      />
                      <Text className="font-noto-bold text-caption font-bold text-primary">
                        온보딩
                      </Text>
                    </View>
                  ) : null
                }
              />
              <View className="h-[1px] bg-hairline" />
              <SummaryRow
                testID="trip-wizard-summary-budget"
                label="예산"
                value={summaryBudget}
                placeholder="예산 선택"
                placeholderTone="muted"
                onPress={onPressSummaryBudget}
                isLoading={isLoading}
                skeletonTestID="trip-wizard-summary-skeleton-5"
                skeletonWidths={[64, 78]}
              />
            </View>

            {/* 꼭 갈 곳 — loading 이면 스켈레톤 카드, 아니면 실제 스트립 */}
            {isLoading ? (
              <MustVisitSkeleton />
            ) : (
              <MustVisitStrip
                mustVisits={mustVisits}
                onPressMore={onPressMore}
                onPressSeeAll={onPressSeeAll}
              />
            )}
          </View>
        </ScrollView>

        {/* 하단바 — 실패 배너(있을 때만) + [다음] */}
        <View className="border-t border-hairline bg-canvas px-lg pb-[20px] pt-md">
          {submitError ? (
            <View
              testID="trip-wizard-submit-banner"
              className="mb-sm flex-row items-center gap-md rounded-button border border-hairline bg-canvas px-lg py-md"
            >
              <AlertCircleGlyph size={18} />
              {/* §F ⓐ: submitError 는 표시값이 아니라 배너를 켜는 트리거다 — 서버 사유·옛 제목은 안 그린다. */}
              <Text className="flex-1 font-noto text-card-title text-ink">
                저장하지 못했어요
              </Text>
              <Pressable
                testID="trip-wizard-submit-banner-retry"
                accessibilityRole="button"
                onPress={onRetrySubmit}
              >
                <Text className="font-noto-bold font-bold text-card-title text-primary">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          ) : null}
          {/* 등록 실패 배너 — 제출 실패 배너와 **같은 자리·다른 testID**다(01b D2). */}
          {mustVisitError ? (
            <View
              testID="trip-wizard-mustvisit-banner"
              className="mb-sm flex-row items-center gap-md rounded-button border border-hairline bg-canvas px-lg py-md"
            >
              <AlertCircleGlyph size={18} />
              <Text className="flex-1 font-noto text-[11.5px] text-primary-text">
                {mustVisitError}
              </Text>
              <Pressable
                testID="trip-wizard-mustvisit-banner-retry"
                accessibilityRole="button"
                onPress={onRetryMustVisits}
              >
                <Text className="font-noto-bold font-bold text-card-title text-primary">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          ) : null}
          {/* 비활성(!canProceed || isLoading)은 opacity-40 이 아니라 연회색 채움(#E9E9EB) + 회색
              글자(muted-soft)로 갈린다(TRIP-732 AC-8). 실제 색 정합은 6-b(스크린샷). */}
          <Pressable
            testID="trip-wizard-step1-next"
            accessibilityRole="button"
            disabled={nextDisabled}
            onPress={onNext}
            className={`w-full flex-row items-center justify-center gap-sm rounded-button py-[15px] ${
              nextDisabled ? 'bg-[#E9E9EB]' : 'bg-primary'
            }`}
          >
            <Text
              className={`text-[16px] font-noto-bold font-bold ${
                nextDisabled ? 'text-muted-soft' : 'text-on-primary'
              }`}
            >
              다음
            </Text>
            <ChevronRightGlyph tone={nextDisabled ? 'muted' : 'onPrimary'} />
          </Pressable>
        </View>

        {/* 국내 밖 차단 다이얼로그(보존, D6) */}
        {overseasBlocked ? (
          <View className="absolute inset-0 items-center justify-center px-xl">
            <Pressable
              testID="trip-wizard-overseas-backdrop"
              className="absolute inset-0 bg-scrim/[58%]"
              onPress={onCloseOverseasDialog}
            />
            <View
              testID="trip-wizard-overseas-dialog"
              className="w-full max-w-[310px] items-center gap-[8px] rounded-[20px] bg-canvas px-xl pb-[18px] pt-[22px]"
            >
              <View className="h-[56px] w-[56px] items-center justify-center rounded-pill bg-primary-pale">
                <GlobeGlyph />
              </View>
              <Text className="text-section font-noto-bold font-bold text-ink">
                지금은 국내 여행만 지원해요
              </Text>
              <View className="items-center">
                <Text className="text-center font-noto text-label text-muted">
                  국내 도시로 만들어볼까요?
                </Text>
              </View>
              <Pressable
                testID="trip-wizard-overseas-dialog-confirm"
                accessibilityRole="button"
                onPress={onPickDomesticRegion}
                className="w-full items-center justify-center rounded-button bg-primary py-[13px]"
              >
                <Text className="text-[15.5px] font-noto-bold font-bold text-on-primary">
                  국내 도시 고르기
                </Text>
              </Pressable>
              <Pressable
                testID="trip-wizard-overseas-dialog-close"
                accessibilityRole="button"
                onPress={onCloseOverseasDialog}
                className="items-center justify-center py-[10px]"
              >
                <Text className="text-[13.5px] font-noto-bold font-bold text-muted">
                  닫기
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
