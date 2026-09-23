import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapView } from '@/shared/map';

import type { DraftPin } from '../model/draftView';
import {
  GENERATION_FALLBACK_CHECK_DONE,
  GENERATION_FALLBACK_CHECK_ROUTE,
  GENERATION_FALLBACK_CHECK_SKIPPED,
  GENERATION_FALLBACK_FAILED_NOTE,
  GENERATION_FALLBACK_FAILED_TITLE,
  GENERATION_FALLBACK_INFO,
  GENERATION_FALLBACK_MANUAL,
  GENERATION_FALLBACK_MAP_PILL,
  GENERATION_FALLBACK_MESSAGE_BODY,
  GENERATION_FALLBACK_MESSAGE_TITLE,
  GENERATION_FALLBACK_PROGRESS,
  GENERATION_FALLBACK_RETRY,
  GENERATION_FALLBACK_TITLE,
  GENERATION_FALLBACK_VIEW_PLAN,
} from '../config/generationFallback';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  CheckGlyph,
  DashGlyph,
  InfoCircleGlyph,
} from './ItineraryGlyphs';

/**
 * h07 [완전AI] 일정 생성 · fallback — Figma `3831:2177`.
 *
 * **폴백 인터스티셜**이다(01b ⑦). AI 가 취향을 못 넣고 기본 동선만 그렸다는 사실을 먼저 보여주고,
 * [기본 일정 보기]로 넘어가야 실제 초안을 본다 — 곁줄 배너(DraftScreen)를 대체해 세 폴백 신호
 * (deterministic·minimal·demoted)와 하드 실패(생성 자체 실패)를 한 얼굴에 흡수한다(INV-4).
 *
 * 화면은 **완성된 값만 받는다**(props-only) — `solveMode`·`isFallback`·`candidatesSummary`
 * 원천 신호도 그 어휘도 모른다(판정은 model 의 `resolveFallbackNotice`, 라우팅은 DraftPage).
 * 성공(폴백)과 하드실패는 `failed` 한 축의 데이터 분기이고 **상호배타**다.
 *
 * 지도 출처 표기(© Kakao)는 넣지 않는다 — 코드 지도는 네이버 네이티브 SDK 라 출처를 `MapView`
 * 가 스스로 그린다(figma-traps: 출처 표기는 세대 판정 축이 아니다).
 */

// 카드·pill 그림자(Figma `0px 2px 10px rgba(0,0,0,0.06)`). RN 은 box-shadow 가 없어 스타일
// 프로퍼티로 옮긴다 — 그림자는 토큰 대상이 아니다(`DraftScreen`·`ZeroCandidateScreen` 선례).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

export interface GenerationFallbackScreenProps {
  /** true=하드 실패(히어로만), false/미지정=성공(폴백) 변형. */
  failed?: boolean;
  /** 체크리스트 1행의 N. **미지정이면 그 행을 안 그린다**(0곳 오표기보다 미표기가 정직 · 01b D4). */
  mustVisitCount?: number;
  /** 성공 변형 지도 카드용. `pins.length>0` 일 때만 지도가 뜬다(center=pins[0]). */
  pins?: DraftPin[];
  /** 주 CTA "기본 일정 보기" — DraftPage 로컬 dismiss(01b D3, route push 아님). */
  onViewPlan: () => void;
  /** 텍스트 링크 "직접 짜기" — 수동 짜기 라우트. 두 변형 공통. */
  onManualPlan: () => void;
  /** 실패 CTA "다시 시도". */
  onRetry: () => void;
  /** 앱바 뒤로. */
  onBack: () => void;
}

/** 체크리스트 한 행 — 마커(초록 체크 / 회색 대시) + 라벨. `n` 은 testID 접미이자 순서 앵커다. */
type ChecklistRow = {
  n: number;
  label: string;
  marker: 'check' | 'dash';
};

function ProgressBar(): ReactElement {
  // 세그먼트 4개(전부 채움 = 마지막 단계) + "4 / 4". h01(점 4개)과 다른 표현(막대 4개).
  return (
    <View className="flex-row items-center gap-[6px]">
      <View className="flex-row items-center gap-xs">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} className="h-[4px] w-[14px] rounded-[2px] bg-primary" />
        ))}
      </View>
      <Text className="font-inter-bold text-caption text-muted">
        {`${GENERATION_FALLBACK_PROGRESS.current} / ${GENERATION_FALLBACK_PROGRESS.total}`}
      </Text>
    </View>
  );
}

export function GenerationFallbackScreen({
  failed = false,
  mustVisitCount,
  pins = [],
  onViewPlan,
  onManualPlan,
  onRetry,
  onBack,
}: GenerationFallbackScreenProps): ReactElement {
  // 체크리스트 4행. ①행은 N 이 주입됐을 때만 뜬다(미지정 → 안 그림, 01b D4). testID 접미(n)는
  // 그 행이 빠져도 고정이라 초록 체크가 붙는 행은 언제나 1·2·4 다.
  const checklist: ChecklistRow[] = [
    ...(mustVisitCount === undefined
      ? []
      : [
          {
            n: 1,
            label: `꼭 갈 곳 ${mustVisitCount}곳 배치`,
            marker: 'check' as const,
          },
        ]),
    { n: 2, label: GENERATION_FALLBACK_CHECK_ROUTE, marker: 'check' },
    { n: 3, label: GENERATION_FALLBACK_CHECK_SKIPPED, marker: 'dash' },
    { n: 4, label: GENERATION_FALLBACK_CHECK_DONE, marker: 'check' },
  ];

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="itinerary-fallback-root" className="flex-1 bg-canvas">
        {/* 앱바 — 두 변형 공통. */}
        <View className="w-full flex-row items-center gap-[6px] bg-canvas pb-md pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-fallback-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-section font-bold text-ink">
            {GENERATION_FALLBACK_TITLE}
          </Text>
          <View className="flex-1" />
          <ProgressBar />
        </View>

        {failed ? (
          // 하드 실패 — 히어로만(지도·메시지·체크리스트·안내바 감춤). 생성 자체가 실패라 그릴 동선이
          // 없다(01b D5). itinerary-fallback-failed 는 제목 Text 에만 달아 완전일치 단언이 노트를
          // 함께 물지 않게 한다(02a §5 · RNTL toHaveTextContent = 완전일치).
          <View className="flex-1 items-center justify-center gap-md px-lg">
            <View className="h-[88px] w-[88px] items-center justify-center rounded-pill bg-primary-pale">
              <AlertCircleGlyph size={36} tone="primaryText" />
            </View>
            <Text
              testID="itinerary-fallback-failed"
              className="text-center font-noto-bold text-[20px] font-bold text-ink"
            >
              {GENERATION_FALLBACK_FAILED_TITLE}
            </Text>
            <Text className="text-center font-noto text-label text-muted">
              {GENERATION_FALLBACK_FAILED_NOTE}
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerClassName="gap-lg px-md pb-xl pt-md">
            {/* 지도 카드 — 기본 동선(핀 route + 연결 실선). viewOnly(글랜스) · connectPins 기본(=선). */}
            {pins.length > 0 ? (
              <View
                testID="itinerary-fallback-map"
                className="h-[201px] w-full overflow-hidden rounded-button border border-hairline"
              >
                <MapView
                  center={{ lat: pins[0].lat, lng: pins[0].lng }}
                  pins={pins}
                  viewOnly
                />
                {/* 좌상단 pill — "기본 동선으로 그렸어요"(Figma `3831:2191`). */}
                <View
                  style={cardShadow}
                  className="absolute left-md top-md rounded-[8px] bg-canvas px-md py-[7px]"
                >
                  <Text className="font-noto text-caption text-ink">
                    {GENERATION_FALLBACK_MAP_PILL}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* 메시지 카드. */}
            <View
              testID="itinerary-fallback-message"
              style={cardShadow}
              className="w-full gap-[6px] rounded-button border border-hairline bg-canvas p-lg"
            >
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                {GENERATION_FALLBACK_MESSAGE_TITLE}
              </Text>
              <Text className="font-noto text-label text-muted">
                {GENERATION_FALLBACK_MESSAGE_BODY}
              </Text>
            </View>

            {/* 체크리스트 — 3행만 대시·회색(취향 반영 건너뜀). */}
            <View className="w-full gap-[14px] px-xs py-[2px]">
              {checklist.map((row) => (
                <View
                  key={row.n}
                  testID={`itinerary-fallback-check-${row.n}`}
                  className="w-full flex-row items-center gap-md"
                >
                  {row.marker === 'check' ? (
                    <CheckGlyph
                      size={18}
                      tone="success"
                      testID={`itinerary-fallback-mark-check-${row.n}`}
                    />
                  ) : (
                    <DashGlyph
                      size={18}
                      testID="itinerary-fallback-mark-dash"
                    />
                  )}
                  <Text
                    className={
                      row.marker === 'dash'
                        ? 'font-noto text-label text-muted'
                        : 'font-noto-bold text-body font-bold text-ink'
                    }
                  >
                    {row.label}
                  </Text>
                </View>
              ))}
            </View>

            {/* 안내바. */}
            <View
              testID="itinerary-fallback-info"
              className="min-h-[52px] w-full flex-row items-center gap-md rounded-button border border-hairline bg-canvas px-lg py-md"
            >
              <InfoCircleGlyph />
              <Text className="flex-1 font-noto text-card-title text-ink">
                {GENERATION_FALLBACK_INFO}
              </Text>
            </View>
          </ScrollView>
        )}

        {/* 하단 고정 바 — 성공: 기본 일정 보기 / 실패: 다시 시도. 직접 짜기 링크는 공통. */}
        <View className="w-full gap-sm border-t border-hairline bg-canvas px-md pb-xl pt-md">
          {failed ? (
            <Pressable
              testID="itinerary-fallback-retry"
              accessibilityRole="button"
              onPress={onRetry}
              className="w-full items-center justify-center rounded-button bg-primary py-[15px]"
            >
              <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                {GENERATION_FALLBACK_RETRY}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              testID="itinerary-fallback-view-plan"
              accessibilityRole="button"
              onPress={onViewPlan}
              className="w-full items-center justify-center rounded-button bg-primary py-[15px]"
            >
              <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                {GENERATION_FALLBACK_VIEW_PLAN}
              </Text>
            </Pressable>
          )}
          <Pressable
            testID="itinerary-fallback-manual"
            accessibilityRole="button"
            onPress={onManualPlan}
            className="min-h-[44px] w-full items-center justify-center pb-sm pt-md"
          >
            <Text className="font-noto-bold text-body font-bold text-ink">
              {GENERATION_FALLBACK_MANUAL}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
