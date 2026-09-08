import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateNotice } from '@/shared/ui/StateNotice';
import {
  BackChevronGlyph,
  BedGlyph,
  ChevronRightGlyph,
  WarningTriangleGlyph,
} from '@/features/trip/ui/TripGlyphs';
import { formatWizardStep } from '@/features/trip/model/tripSummary';

/**
 * g02 거점 숙소 2/4 — **props만 받는 프레젠테이션 화면**(TRIP-672, Figma `3657:2068` 재작성).
 * 옛 후보 하트 배정 모델(후보 카드·coverage 차단 게이트·연박 묶음·fixSheet)을 전부 걷어내고
 * **박별(1박=1행) 거점 카드**로 바꾼다. 밤마다 날짜·지역·숙소명(or "숙소 미정")을 그리고,
 * 카드 탭은 그 밤의 `nightNumber`로 숙소 선택 시트(S9) 오픈 신호를 낼 뿐이다.
 *
 * 이 화면이 하지 않는 것: 조회·라우팅·스토어 접근, 날짜·지역 파생(`nightlyBaseCards`는 배선
 * 몫 — 화면이 부르면 파생이 두 곳에 산다). 완성된 카드 뷰모델(`cards`)만 받아 그린다.
 * 진행을 막는 게이트도 없다 — 두 CTA는 언제나 활성이다(숙소는 선택 사항, BR-U1-40).
 *
 * `formatWizardStep`(순수 셀렉터)만 직접 소비한다 — 진행 문자열의 단일 출처라 표시 포맷이고,
 * S1(g01) 자매 화면과 같은 형태다(경계 위반 아님).
 */

/** 여행 정보를 못 찾은 얼굴(딥링크로 tripId 없이 열린 경우). 그 상태의 프레임이 Figma에 없어
 * 발명이다 — 뒤집히면 이 세 줄만 바꾼다. */
const NO_TRIP_TITLE = '여행 정보를 찾을 수 없어요';
const NO_TRIP_DESCRIPTION = '여행 만들기를 처음부터 다시 시작해 주세요';
const NO_TRIP_ACTION = '처음부터';

/** error 얼굴 — 옛 화면에서 온 실측 문구를 그대로 잇는다(골격 보존). */
const LOAD_ERROR_TITLE = '지금 거점 정보를 불러올 수 없어요';
const LOAD_ERROR_DESCRIPTION = '잠시 후 다시 시도해 주세요';
const RETRY_LABEL = '다시 시도';

/** 미배정 밤의 숙소칸 대체 문구 — 카드 탭으로 S9에서 고른다. */
const UNASSIGNED_STAY_LABEL = '숙소 미정';

export interface NightlyBaseCardVM {
  nightNumber: number;
  dateLabel: string;
  region: string;
  stayName?: string;
}

export type Step2Variant = 'default' | 'loading' | 'error' | 'notrip';

export interface TripWizardStep2ScreenProps {
  variant: Step2Variant;
  cards: NightlyBaseCardVM[];
  /** 카드 탭 → 그 밤의 `nightNumber`로 숙소 선택 시트(S9) 오픈 신호. */
  onPressCard: (nightNumber: number) => void;
  /** "이 거점으로 일정 만들기". */
  onGenerate: () => void;
  /** "숙소 없이 시작하기". */
  onNoStayStart: () => void;
  onBack: () => void;
  /** error 얼굴 재시도. */
  onRetryAll: () => void;
  /** notrip 얼굴 "처음부터". */
  onRestart: () => void;
}

function Header({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-sm bg-canvas px-lg pb-[14px] pt-xl">
      <Pressable
        testID="trip-base-back"
        accessibilityRole="button"
        onPress={onBack}
        hitSlop={8}
      >
        <BackChevronGlyph />
      </Pressable>
      <Text className="font-noto-bold text-section font-bold text-ink">
        거점 숙소
      </Text>
      <View className="flex-1" />
      {/* 진행바 4칸 — Figma가 네 칸 모두 같은 너비라 활성은 색으로만 갈린다(앞 2칸 primary). */}
      <View className="flex-row items-center gap-xs">
        {[1, 2, 3, 4].map((n) => (
          <View
            key={n}
            testID={`trip-wizard-progress-seg-${n}`}
            className={`h-1 w-[14px] rounded-[2px] ${
              n <= 2 ? 'bg-primary' : 'bg-hairline-strong'
            }`}
          />
        ))}
        <Text className="ml-[2px] font-inter-bold text-caption text-muted">
          {formatWizardStep(2)}
        </Text>
      </View>
    </View>
  );
}

/** 박별 거점 카드 한 장 — 탭하면 그 밤 번호로 오픈 신호를 낸다. 메타 한 줄(박·날짜·지역)과
 * 숙소명(없으면 "숙소 미정") 줄, 우측 셰브런. */
function NightCard({
  card,
  onPressCard,
}: {
  card: NightlyBaseCardVM;
  onPressCard: (nightNumber: number) => void;
}): ReactElement {
  return (
    <Pressable
      testID={`trip-base-night-card-${card.nightNumber}`}
      accessibilityRole="button"
      onPress={() => onPressCard(card.nightNumber)}
      className="w-full gap-[6px] rounded-card border border-hairline bg-canvas px-lg py-[14px]"
    >
      <Text className="font-noto text-caption text-muted">
        {`${card.nightNumber}박 · ${card.dateLabel} · ${card.region}`}
      </Text>
      <View className="w-full flex-row items-center gap-md">
        <Text className="flex-1 font-noto-bold text-card-title font-bold text-ink">
          {card.stayName ?? UNASSIGNED_STAY_LABEL}
        </Text>
        <ChevronRightGlyph size={20} tone="muted" />
      </View>
    </Pressable>
  );
}

/** 로딩 중 박별 행 자리표시자 — 옛 후보 카드 스켈레톤이 아니라 카드 한 줄 크기의 회색 바다. */
function NightSkeleton({ index }: { index: number }): ReactElement {
  return (
    <View
      testID={`trip-base-skeleton-night-${index}`}
      className="w-full gap-[8px] rounded-card border border-hairline bg-canvas px-lg py-[14px]"
    >
      <View className="h-[12px] w-[160px] rounded-[6px] bg-surface-strong" />
      <View className="h-[16px] w-[200px] rounded-[6px] bg-hairline" />
    </View>
  );
}

/** guide 한 줄 — 옛 2줄 OnrampBanner를 대체(긍정 프레이밍). */
function GuideRow(): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-sm">
      <BedGlyph size={18} tone="muted" />
      <Text className="flex-1 font-noto text-caption text-muted">
        숙소는 나중에 정해도 돼요 · 동선 기준으로 추천해 드려요
      </Text>
    </View>
  );
}

export function TripWizardStep2Screen({
  variant,
  cards,
  onPressCard,
  onGenerate,
  onNoStayStart,
  onBack,
  onRetryAll,
  onRestart,
}: TripWizardStep2ScreenProps): ReactElement {
  const loading = variant === 'loading';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="trip-base-step2-root" className="flex-1 bg-canvas">
        <Header onBack={onBack} />

        {variant === 'error' ? (
          <View className="flex-1 items-center justify-center px-lg">
            <StateNotice
              testID="trip-base-error"
              icon={<WarningTriangleGlyph />}
              title={LOAD_ERROR_TITLE}
              description={LOAD_ERROR_DESCRIPTION}
              actions={[
                {
                  testID: 'trip-base-error-retry',
                  label: RETRY_LABEL,
                  variant: 'filled',
                  onPress: onRetryAll,
                },
                {
                  testID: 'trip-base-error-nostay',
                  label: '숙소 없이 시작하기',
                  variant: 'outline',
                  onPress: onNoStayStart,
                },
              ]}
            />
          </View>
        ) : null}

        {variant === 'notrip' ? (
          <View className="flex-1 items-center justify-center px-lg">
            <StateNotice
              testID="trip-base-notrip"
              icon={<WarningTriangleGlyph />}
              title={NO_TRIP_TITLE}
              description={NO_TRIP_DESCRIPTION}
              actions={[
                {
                  testID: 'trip-base-notrip-restart',
                  label: NO_TRIP_ACTION,
                  variant: 'filled',
                  onPress: onRestart,
                },
              ]}
            />
          </View>
        ) : null}

        {variant === 'default' || loading ? (
          <>
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingBottom: 26 }}
            >
              <View className="w-full gap-xl px-lg pt-md">
                <Text className="font-noto-bold text-display font-bold text-ink">
                  어디서 묵을까요?
                </Text>

                <View className="w-full gap-md">
                  {loading
                    ? [0, 1, 2].map((index) => (
                        <NightSkeleton key={index} index={index} />
                      ))
                    : cards.map((card) => (
                        <NightCard
                          key={card.nightNumber}
                          card={card}
                          onPressCard={onPressCard}
                        />
                      ))}
                </View>

                <GuideRow />
              </View>
            </ScrollView>

            {/* TRIP-493 — 두 CTA를 스크롤 밖 하단에 고정한다(step1 `[다음]`과 같은 규칙). 카드가
                많아도 진행하는 문이 카드 아래 파묻히지 않는다. 게이트가 없어 둘 다 항상 활성이다. */}
            <View className="border-t border-hairline bg-canvas px-lg pb-[18px] pt-md gap-md">
              <Pressable
                testID="trip-base-generate"
                accessibilityRole="button"
                onPress={onGenerate}
                className="w-full items-center justify-center rounded-button bg-primary p-lg"
              >
                <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
                  이 거점으로 일정 만들기
                </Text>
              </Pressable>
              <Pressable
                testID="trip-base-nostay-start"
                accessibilityRole="button"
                onPress={onNoStayStart}
                className="w-full items-center justify-center py-xs"
              >
                <Text className="font-noto-bold text-body font-bold text-muted">
                  숙소 없이 시작하기
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
