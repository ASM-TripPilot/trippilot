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

export type Step2Variant = 'default' | 'loading' | 'error' | 'empty' | 'notrip';

export interface TripWizardStep2ScreenProps {
  variant: Step2Variant;
  cards: NightlyBaseCardVM[];
  /** 카드 탭 → 그 밤의 `nightNumber`로 숙소 선택 시트(S9) 오픈 신호. */
  onPressCard: (nightNumber: number) => void;
  /** "이 거점으로 일정 만들기". */
  onGenerate: () => void;
  /** "숙소 없이 시작하기"(default·loading) / "숙소 없이 계속"(empty) — 같은 no-stay 진행(goToMethod). */
  onNoStayStart: () => void;
  /** empty 얼굴 보조 CTA "숙소 둘러보기" → `/stays`. */
  onBrowseStays: () => void;
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

/** empty 얼굴(저장 숙소 0)의 박별 미정 행 — 메타 한 줄 + 셰브런만(숙소명/"숙소 미정" 둘째 줄 없음).
 * `NightCard`가 항상 그리는 둘째 줄과 충돌해 재사용 못 하므로 별도 행 컴포넌트다. 탭은 default 미배정
 * 행과 똑같이 그 밤 번호로 S9 시트 오픈 신호를 낸다. 카드 크롬(rounded-card·hairline)은 default 와
 * 같게 둔다 — 얼굴이 갈려도 카드 모양은 앱 안에서 한 결이다. */
function EmptyNightRow({
  card,
  onPressCard,
}: {
  card: NightlyBaseCardVM;
  onPressCard: (nightNumber: number) => void;
}): ReactElement {
  return (
    <Pressable
      testID={`trip-base-empty-night-${card.nightNumber}`}
      accessibilityRole="button"
      onPress={() => onPressCard(card.nightNumber)}
      className="w-full flex-row items-center rounded-card border border-hairline bg-canvas px-lg py-[14px]"
    >
      <Text className="flex-1 font-noto text-caption text-muted">
        {`${card.nightNumber}박 · ${card.dateLabel} · ${card.region}`}
      </Text>
      <ChevronRightGlyph size={20} tone="muted" />
    </Pressable>
  );
}

/** 로딩 중 박별 행 자리표시자(TRIP-674 재작성, Figma `3718:2068`) — 상단 메타 바 하나 + 아래 48px
 * 정사각 썸네일 + 세로 2바(제목·서브)로, 실제 박별 카드의 뼈대를 회색으로 흉내낸다(썸네일+3바).
 * 자매 g01(S7) 스켈레톤과 같은 토큰(`bg-surface-strong`·`rounded-[6px]`). 색·크기·정렬은 jest 사각
 * (className 만 트리에 남음)이라 6-b 실기가 유일한 육안 그물. */
function NightSkeleton({ index }: { index: number }): ReactElement {
  return (
    <View
      testID={`trip-base-skeleton-night-${index}`}
      className="w-full gap-md rounded-card border border-hairline bg-canvas px-lg py-[14px]"
    >
      <View className="h-[14px] w-[92px] rounded-[6px] bg-surface-strong" />
      <View className="w-full flex-row items-center gap-md">
        <View className="h-[48px] w-[48px] rounded-thumb bg-surface-strong" />
        <View className="flex-1 gap-sm">
          <View className="h-[14px] w-[150px] rounded-[6px] bg-hairline" />
          <View className="h-[12px] w-[104px] rounded-[6px] bg-surface-strong" />
        </View>
      </View>
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
  onBrowseStays,
  onBack,
  onRetryAll,
  onRestart,
}: TripWizardStep2ScreenProps): ReactElement {
  const loading = variant === 'loading';
  const empty = variant === 'empty';

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

        {variant === 'default' || loading || empty ? (
          <>
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingBottom: 26 }}
            >
              <View className="w-full gap-xl px-lg pt-md">
                {/* 타이틀 + 얼굴별 부제 — default 는 부제 없음, loading·empty 만 한 줄 붙는다(맹점②,
                    색 토큰이 갈린다: loading=muted-soft·empty=muted). */}
                <View className="w-full gap-xs">
                  <Text className="font-noto-bold text-display font-bold text-ink">
                    어디서 묵을까요?
                  </Text>
                  {loading ? (
                    <Text className="font-noto text-label text-muted-soft">
                      거점을 불러오는 중
                    </Text>
                  ) : null}
                  {empty ? (
                    <Text className="font-noto text-label text-muted">
                      저장한 숙소가 없어요 · 밤마다 골라도 되고 나중에 정해도
                      돼요
                    </Text>
                  ) : null}
                </View>

                <View className="w-full gap-md">
                  {loading
                    ? [0, 1, 2].map((index) => (
                        <NightSkeleton key={index} index={index} />
                      ))
                    : empty
                      ? cards.map((card) => (
                          <EmptyNightRow
                            key={card.nightNumber}
                            card={card}
                            onPressCard={onPressCard}
                          />
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
                많아도 진행하는 문이 카드 아래 파묻히지 않는다. 게이트가 없어 둘 다 항상 활성이다.
                empty 는 주 CTA 가 "숙소 없이 계속"(generate 자리를 대신, testID 는 nostay-start 로
                default 링크와 공유·같은 동작) + 보조 "숙소 둘러보기"(trip-base-browse)라 generate 가 없다. */}
            <View className="border-t border-hairline bg-canvas px-lg pb-[18px] pt-md gap-md">
              {empty ? (
                <>
                  <Pressable
                    testID="trip-base-nostay-start"
                    accessibilityRole="button"
                    onPress={onNoStayStart}
                    className="w-full items-center justify-center rounded-button bg-primary p-lg"
                  >
                    <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
                      숙소 없이 계속
                    </Text>
                  </Pressable>
                  <Pressable
                    testID="trip-base-browse"
                    accessibilityRole="button"
                    onPress={onBrowseStays}
                    className="w-full items-center justify-center py-xs"
                  >
                    <Text className="font-noto-bold text-body font-bold text-muted">
                      숙소 둘러보기
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
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
                </>
              )}
            </View>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
