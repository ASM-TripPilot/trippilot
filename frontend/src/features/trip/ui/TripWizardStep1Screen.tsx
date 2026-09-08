import type { ReactElement } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { MustVisitSeedItem } from '../model/mustVisitSeed';
import { formatWizardStep } from '../model/tripSummary';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  ChevronRightGlyph,
  GlobeGlyph,
  PlusGlyph,
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
  /** 요약 5행 — 페이지가 `tripSummary` 셀렉터로 도출한 완성형 문자열. `null` = 미선택(플레이스홀더). */
  summaryDestinations: string | null;
  summaryPeriod: string | null;
  summaryCompanion: string | null;
  summaryPreferences: string | null;
  summaryBudget: string | null;
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
 * 요약 카드 한 행 — 라벨 + 값(있으면 ink) 또는 플레이스홀더(없으면) + 우측 chevron. 행 전체가
 * Pressable 이라 탭하면 편집 시트 오픈 콜백을 부른다(값 조립은 페이지 몫이라 화면은 받은 문자열을
 * 그대로 그린다).
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
}: {
  testID: string;
  label: string;
  value: string | null;
  /** value 가 null 일 때 그릴 카피. `null` 이면 값 줄 자체를 안 그린다(기간 행). */
  placeholder: string | null;
  /** 플레이스홀더 색 톤 — 여행지만 'ink'(Figma empty 진한 값 톤), 나머지는 'muted'. */
  placeholderTone: 'ink' | 'muted';
  onPress(): void;
  /** loading 얼굴 — 값 자리에 회색 스켈레톤 바(라벨은 유지). */
  isLoading?: boolean;
  skeletonTestID: string;
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
          <View
            testID={skeletonTestID}
            className="h-[16px] w-[148px] rounded-[6px] bg-surface-strong"
          />
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
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            {value}
          </Text>
        )}
      </View>
      <ChevronRightGlyph size={20} tone="muted" />
    </Pressable>
  );
}

/**
 * 꼭 갈 곳 가로 스트립 — 헤더("꼭 갈 곳 {N}" + 전체 보기) + 스크롤 행([더 담기 첫 위치] + 담은
 * 곳 카드들). 카드는 이미지 자리 + 이름만이다(지역명은 계약 공백, D3). 이미지는 `imageUrl` 이
 * 있을 때만 그린다 — 없으면 회색 자리로 두고 기본 이미지를 지어내지 않는다(INV-1).
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
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * 꼭 갈 곳 로딩 스켈레톤(TRIP-671 loading 얼굴) — 헤더는 숫자 없는 "꼭 갈 곳" + 캡션, 스트립 자리에
 * 회색 카드 4장(점선 "+ 더 담기" 박스 없음). 회색바 토큰은 `TripWizardStep2Screen` 스켈레톤 미러
 * (`bg-surface-strong`·`rounded-[14px]`·`rounded-[6px]`, raw hex 0) — 색·크기·정렬은 jest 사각(6-b).
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
        contentContainerStyle={{ gap: 10 }}
      >
        {[1, 2, 3, 4].map((n) => (
          <View
            key={n}
            testID={`trip-wizard-mustvisit-skeleton-${n}`}
            className="w-[112px] gap-[6px]"
          >
            <View className="h-[88px] w-[112px] rounded-[14px] bg-surface-strong" />
            <View className="h-[14px] w-[80px] rounded-[6px] bg-surface-strong" />
          </View>
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
              <Text className="font-noto text-label text-muted">
                {isLoading
                  ? '여행 정보를 불러오는 중이에요'
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
              />
              <View className="h-[1px] bg-hairline" />
              <SummaryRow
                testID="trip-wizard-summary-preference"
                label="취향"
                value={summaryPreferences}
                placeholder="취향 선택"
                placeholderTone="muted"
                onPress={onPressSummaryPreference}
                isLoading={isLoading}
                skeletonTestID="trip-wizard-summary-skeleton-4"
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
              className="mb-sm flex-row items-start gap-[10px] rounded-button bg-primary-pale p-md"
            >
              <AlertCircleGlyph size={18} />
              <View className="flex-1 gap-[2px]">
                <Text className="font-noto-bold text-label font-bold text-primary-text">
                  여행을 만들지 못했어요
                </Text>
                <Text className="font-noto text-[11.5px] text-primary-text">
                  {submitError}
                </Text>
              </View>
              <Pressable
                testID="trip-wizard-submit-banner-retry"
                accessibilityRole="button"
                onPress={onRetrySubmit}
                className="items-center justify-center rounded-pill border-[1.4px] border-primary bg-canvas px-md py-[7px]"
              >
                <Text className="text-[12.5px] font-noto-bold font-bold text-primary-text">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          ) : null}
          {/* 등록 실패 배너 — 제출 실패 배너와 **같은 자리·다른 testID**다(01b D2). */}
          {mustVisitError ? (
            <View
              testID="trip-wizard-mustvisit-banner"
              className="mb-sm flex-row items-center gap-[10px] rounded-button bg-primary-pale p-md"
            >
              <AlertCircleGlyph size={18} />
              <Text className="flex-1 font-noto text-[11.5px] text-primary-text">
                {mustVisitError}
              </Text>
              <Pressable
                testID="trip-wizard-mustvisit-banner-retry"
                accessibilityRole="button"
                onPress={onRetryMustVisits}
                className="items-center justify-center rounded-pill border-[1.4px] border-primary bg-canvas px-md py-[7px]"
              >
                <Text className="text-[12.5px] font-noto-bold font-bold text-primary-text">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable
            testID="trip-wizard-step1-next"
            accessibilityRole="button"
            disabled={nextDisabled}
            onPress={onNext}
            className={`w-full flex-row items-center justify-center gap-sm rounded-button bg-primary py-[15px] ${
              nextDisabled ? 'opacity-40' : ''
            }`}
          >
            <Text className="text-[16px] font-noto-bold font-bold text-on-primary">
              다음
            </Text>
            <ChevronRightGlyph />
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
                  해외 여행지는 준비 중이에요.
                </Text>
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
