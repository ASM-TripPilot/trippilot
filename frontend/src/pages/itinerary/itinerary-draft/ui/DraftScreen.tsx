import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateNotice } from '@/shared/ui/StateNotice';

import type { DraftDayTab, DraftView } from '@/features/itinerary/index.view';
import { Skeleton } from '@/shared/ui/Skeleton';
import { DayChipScroller } from '@/widgets/map-sheet-shell';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  CheckCircleGlyph,
  InfoCircleGlyph,
} from '@/features/itinerary/index.view';

import { DraftFallbackBanner } from './DraftFallbackBanner';

/**
 * h11 [완전AI] AI 추천안 초안 — **남는 얼굴**(loading·failed·empty)만 그린다.
 *
 * 슬롯 목록 얼굴(`listed`)은 TRIP-1039 부터 `DraftPage` 가 공용 지도+시트 셸(h08)로 그려 프로덕션에서 이 화면에 닿지
 * 않았다 — 그 죽은 분기(카드·완성 CTA·교체 트리거·reason 부제·일부 실패 줄·지도 카드)를 TRIP-1352 에서 코드째
 * 지웠다(결정 C). `view.kind === 'listed'` 가 들어와도 머리줄·제목만 그리고 본문은 없다.
 *
 * 화면은 완성된 값만 받는다 — 조회도 판정도 하지 않는다. 우상단 `직접 고르기`는 수동 짜기 라우트로 배선된다
 * (`onManualPlan`). 시간대 라벨의 성격 축(`· 활동`)은 매핑 정본이 없어 시간 축만 낸다(01b D4).
 */

const SCREEN_TITLE = 'AI 추천안';
/** 우상단 링크 라벨 — 수동 짜기 라우트로 간다(TRIP-483 AC-4). */
const PICK_MANUAL_LABEL = '직접 고르기';
const REASON_TITLE = '취향·거리로 채운 추천안이에요';
/** 초안을 새로 생성한다(POST 재호출). 확정된 일정에서는 확정이 풀리므로 비활성이다. */
const RETRY_LABEL = '다시 만들기';
/** 폴백(인터스티셜을 넘긴 목록)이면 제목·reason 제목이 "AI 추천"을 말하지 않는다 — 취향 반영
 * 없이 만든 일정이라서다(BR-U3-11 · US-SCHED-09 "기본 모드" 결 · TRIP-1008 D6). */
const FALLBACK_LABEL = '기본 일정';
const FALLBACK_REASON_TITLE = '취향 반영 없이 만든 기본 일정이에요';
// 폴백 배너(deterministic·minimal)는 TRIP-791 로 전용 인터스티셜(GenerationFallbackScreen)로
// 승격돼 이 화면에서 소멸했다. 후보 부족(LOW)은 폴백이 아니라 인터스티셜로 가지 않는다(TRIP-1174 — 빈 얼굴의
// 후보 부족 줄만 이 화면이 그린다). 판정(resolveFallbackNotice)·라우팅은 DraftPage 가, 그림은 인터스티셜 화면이
// 진다(01b D1·D2).

const EMPTY_TITLE = '아직 만들어진 추천안이 없어요';
const EMPTY_NOTE = `위 ${RETRY_LABEL}를 누르면 AI가 일정을 짜요`;
const FAILED_TITLE = '추천안을 불러오지 못했어요';
const FAILED_NOTE = '네트워크를 확인하고 다시 시도해주세요';

export interface DraftScreenProps {
  view: DraftView;
  /** 여행 기간 전체 — 데이터가 아직 안 온 날짜도 비활성으로 들어 있다. */
  tabs: DraftDayTab[];
  selectedDate: string;
  canRetry: boolean;
  onSelectDay: (date: string) => void;
  onRetry: () => void;
  onBack: () => void;
  /** 「직접 고르기」(우상단) 콜백 — 수동 짜기 라우트로 간다.
   * 미배선이면 어포던스를 아예 안 그린다(후방호환 gated · 死버튼 회피). */
  onManualPlan?: () => void;
  /** 폴백 일정의 목록인가 — `DraftPage` 가 접은 판정 결과만 받는다(원천 신호 어휘는 모른다 · G6). */
  fallback?: boolean;
  /** 후보 부족 안내 문구(TRIP-1174) — 빈 얼굴에서만 그린다. 슬롯이 0곳인 이유가 후보 부족일 수 있어
   * 이 줄이 없으면 그 사실이 조용해진다(INV-4). 판정·문구는 `DraftPage` 가 넘긴다. */
  shortfall?: string | null;
}

function DayTab({
  tab,
  selected,
  onSelectDay,
}: {
  tab: DraftDayTab;
  selected: boolean;
  onSelectDay: (date: string) => void;
}): ReactElement {
  // `disabled` 를 실제로 걸어야 한다 — 회색으로 칠하기만 하면 눌려서 빈 날짜로 전환된다.
  return (
    <Pressable
      testID={`itinerary-draft-day-${tab.dayNumber}`}
      accessibilityRole="button"
      disabled={!tab.hasData}
      onPress={() => onSelectDay(tab.date)}
      className={`flex-row items-center rounded-pill px-md py-[5px] ${
        selected
          ? 'bg-primary-pale'
          : `border ${tab.hasData ? 'border-hairline-strong' : 'border-hairline'}`
      }`}
    >
      <Text
        className={`text-label ${
          selected
            ? 'font-noto-bold font-bold text-primary-text'
            : `font-noto ${tab.hasData ? 'text-body' : 'text-muted-soft'}`
        }`}
      >
        {`${tab.dayNumber}일차`}
      </Text>
    </Pressable>
  );
}

/** 도착 전 자리표시. **글자를 넣지 않는다** — "아직 없어요" 를 미리 그리면 곧 도착할
 * 사용자에게 한 순간 거짓말을 하게 된다(`MustVisitPickerScreen` 선례). */
function LoadingFace(): ReactElement {
  return (
    <View
      testID="itinerary-draft-loading"
      className="w-full gap-md"
      accessibilityLabel="추천안을 만드는 중"
    >
      {[0, 1, 2].map((row) => (
        <Skeleton
          key={row}
          className="h-[98px] w-full rounded-[14px] bg-surface-soft"
        />
      ))}
    </View>
  );
}

export function DraftScreen({
  view,
  tabs,
  selectedDate,
  canRetry,
  onSelectDay,
  onRetry,
  onBack,
  onManualPlan,
  fallback = false,
  shortfall = null,
}: DraftScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] bg-canvas pb-md pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-draft-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text
            testID="itinerary-draft-title"
            className="font-noto-bold text-[19px] font-bold text-ink"
          >
            {fallback ? FALLBACK_LABEL : SCREEN_TITLE}
          </Text>
          <View className="flex-1" />
          {/* 우상단 「직접 고르기」 — 수동 짜기로 나가는 링크(gated · TRIP-483 AC-4). 재생성
              「다시 만들기」는 별개 어포던스라 나란히 공존한다(무회귀 · INV-4). */}
          {onManualPlan === undefined ? null : (
            <Pressable
              testID="itinerary-draft-pick-manual"
              accessibilityRole="button"
              onPress={onManualPlan}
              hitSlop={8}
            >
              <Text className="font-noto text-body text-muted">
                {PICK_MANUAL_LABEL}
              </Text>
            </Pressable>
          )}
          {/* 두 텍스트 버튼이 한 줄로 붙어 읽히지 않게 가는 세로 막대로 가른다(TRIP-1039 · QA #033). */}
          {onManualPlan === undefined ? null : (
            <View
              testID="itinerary-draft-header-divider"
              className="mx-xs h-md w-px bg-hairline-strong"
            />
          )}
          <Pressable
            testID="itinerary-draft-retry"
            accessibilityRole="button"
            disabled={!canRetry}
            onPress={onRetry}
            hitSlop={8}
          >
            <Text
              className={`font-noto text-body ${
                canRetry ? 'text-muted' : 'text-muted-soft'
              }`}
            >
              {RETRY_LABEL}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          testID="itinerary-draft-scroll"
          contentContainerClassName="gap-[14px] px-lg pb-lg pt-md"
        >
          <View className="w-full flex-row items-start gap-[10px]">
            {/* 폴백은 완료(✓)가 아니라 주의라 AlertCircle(TRIP-1039 · QA #033). */}
            {fallback ? <AlertCircleGlyph /> : <CheckCircleGlyph />}
            <View className="flex-1 gap-[3px]">
              <Text
                testID="itinerary-draft-reason-title"
                className="font-noto-bold text-body font-bold text-ink"
              >
                {fallback ? FALLBACK_REASON_TITLE : REASON_TITLE}
              </Text>
            </View>
          </View>

          {tabs.length === 0 ? null : (
            <DayChipScroller
              selectedIndex={tabs.findIndex((tab) => tab.date === selectedDate)}
            >
              {tabs.map((tab) => (
                <DayTab
                  key={tab.date}
                  tab={tab}
                  selected={tab.date === selectedDate}
                  onSelectDay={onSelectDay}
                />
              ))}
            </DayChipScroller>
          )}

          {view.kind === 'loading' ? <LoadingFace /> : null}

          {view.kind === 'failed' ? (
            <StateNotice
              testID="itinerary-draft-failed"
              icon={<AlertCircleGlyph size={32} tone="primaryText" />}
              title={FAILED_TITLE}
              description={FAILED_NOTE}
              actions={[]}
            />
          ) : null}

          {view.kind === 'empty' ? (
            <DraftFallbackBanner
              fallback={false}
              shortfall={shortfall}
              staleFailed={false}
            />
          ) : null}

          {view.kind === 'empty' ? (
            <StateNotice
              testID="itinerary-draft-empty"
              dashed
              icon={<InfoCircleGlyph size={32} tone="primaryText" />}
              title={EMPTY_TITLE}
              description={EMPTY_NOTE}
              actions={[]}
            />
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
