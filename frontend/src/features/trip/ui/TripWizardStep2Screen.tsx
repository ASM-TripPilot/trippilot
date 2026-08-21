import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateNotice } from '@/shared/ui/StateNotice';
import {
  BackChevronGlyph,
  BaseBadgePinGlyph,
  BedGlyph,
  CheckGlyph,
  ChevronRightGlyph,
  HeartFilledGlyph,
  PinGlyph,
  SearchGlyph,
  WarningTriangleGlyph,
} from '@/features/trip/ui/TripGlyphs';
import {
  TripBaseFixSheet,
  type TripBaseFixSheetProps,
} from '@/features/trip/ui/TripBaseFixSheet';

import type { UnresolvedDaysView } from '../model/baseScreen';

/**
 * g02 거점 숙소 2/2 — **props만 받는 프레젠테이션 화면**(TRIP-225).
 * Figma default `1707:1183` · empty `1708:1183` · loading `2454:1500` · error `2454:1639` ·
 * blocked `2454:1778`.
 *
 * 이 화면이 하지 않는 것: 조회·라우팅·스토어 접근, 날짜 포맷, 목록 정렬, 박 번호 산식,
 * **그리고 진행을 막을지의 판정**. 마지막이 핵심이다 — 막을 권위는 서버의 `blocked` 필드
 * 하나이고(INV-2 · 01b D16-b), 이 화면이 받는 것은 그 판정의 **결과**인 `generateDisabled`
 * 하나뿐이다. 불리언 원본을 내려받으면 화면이 미해결 날짜 수와 조합해 다시 판정할 통로가
 * 생긴다.
 *
 * 왜 문구가 여기 사는가: 변형별 정적 카피(Figma가 정한 글자)는 화면의 것이고, 서버 응답에서
 * 파생되는 문구(숙소 이름·박수 라벨·지정 사유·인라인 오류)는 전부 배선이 완성해 내린다.
 *
 * ⚠️ 후보 카드의 **사진·지역·거리·가격 네 자리는 계약에 필드가 없다**(01b D2 — `SavedStay`
 * 13필드 전수 확인). Figma 레이아웃대로 자리는 두되 값은 회색 플레이스홀더다. 없는 값을
 * 지어내면 INV-2 위반이고, 자리까지 지우면 계약이 생겼을 때 레이아웃을 다시 짜야 한다.
 */

/** `createdTripId` 부재 얼굴(01b D7) — 그 상태의 프레임이 Figma에 없어 이 칸의 발명이다
 * (02a §5-6 I-3). 뒤집히면 이 세 줄만 바꾼다. */
const NO_TRIP_TITLE = '여행 정보를 찾을 수 없어요';
const NO_TRIP_DESCRIPTION = '여행 만들기를 처음부터 다시 시작해 주세요';
const NO_TRIP_ACTION = '처음부터';

/** coverage만 실패한 얼굴(01b D15) — 같은 이유로 발명이다(02a §5-6 I-4). */
const COVERAGE_ERROR_MESSAGE = '커버리지를 확인하지 못했어요';

/** error 얼굴은 Figma 실측 문구다(`2456:1506`·`2456:1507`). */
const LOAD_ERROR_TITLE = '지금 거점 정보를 불러올 수 없어요';
const LOAD_ERROR_DESCRIPTION = '잠시 후 다시 시도해 주세요';

/** 인라인 재시도 어포던스 — error 얼굴에서 온 실재 문구를 재사용한다(02a §5-6 I-2). */
const RETRY_LABEL = '다시 시도';

/** 기간 확장 질의의 두 버튼(TRIP-226 · BR-U1-27 "여부를 묻는다"). 정적 카피라 화면이 갖는다 —
 * 안내 문구 자체는 배선이 만들어 내린다(사유에 따라 갈릴 여지가 있는 값이라서). */
const EXTEND_CONFIRM_LABEL = '기간 늘리고 지정';
const EXTEND_CANCEL_LABEL = '그대로 두기';

export interface BaseSectionRow {
  baseAssignmentId: string;
  /** `1–2박` — `toBaseSections`가 만든 값을 그대로 쓴다(재계산 금지). */
  nightLabel: string;
  /** `6/10–6/12`. */
  dateLabel: string;
  /** 빈 문자열은 배선이 이미 대체 문구로 채워 내린다(01b D5). */
  stayName: string;
  changePending: boolean;
  errorText?: string;
}

export interface BaseCandidateRow {
  savedStayId: string;
  name: string;
  /** `거점` 배지 — 배정 응답에서 파생된다(BR-U1-20). `SavedStay` 필드가 아니다. */
  isBase: boolean;
  /** `1–2박에 지정됨`. 있으면 지정 버튼 대신 상태줄을 그린다. */
  assignedLabel?: string;
  assignPending: boolean;
  /** 있으면 지정이 막힌 사유(01b D4). */
  blockedReason?: string;
  /** 여행 기간 밖이다(TRIP-226 · 01b D6 판정 결과). 있으면 경고가 상주하되 **지정을 막지는
   * 않는다** — 거르는 것은 판정이고 판정은 서버 몫이다(D8 · D17). */
  outOfPeriodNote?: string;
  /** 기간 확장 여부를 묻는 중. 있으면 안내 + 확인·취소 두 버튼을 그린다(BR-U1-27). */
  extendPrompt?: string;
  /** 보완 진입 버튼 라벨. 없으면 버튼을 안 그린다 — 멀쩡한 숙소에 고치기 버튼이 붙으면
   * 뭔가 잘못된 것처럼 보인다. */
  fixLabel?: string;
  errorText?: string;
}

export type Step2Variant = 'default' | 'empty' | 'loading' | 'error' | 'notrip';

export interface TripWizardStep2ScreenProps {
  variant: Step2Variant;
  /** `6월 10일–13일` — 배선이 포맷해 내린다. */
  subtitle: string;
  sections: BaseSectionRow[];
  candidates: BaseCandidateRow[];
  /** 서버 판정의 **결과**. 화면은 이 값의 출처를 모른다. */
  generateDisabled: boolean;
  /** 미해결 날짜 안내행. 없으면 안 그린다. */
  unresolved?: UnresolvedDaysView;
  coverageFailed: boolean;
  /** 열려 있는 보완 시트. `undefined`면 시트를 **마운트하지 않는다** — 상시 마운트하면 모든
   * 렌더가 WebView를 태운다(TRIP-226). */
  fixSheet?: TripBaseFixSheetProps;
  /** 아래 셋이 옵셔널인 이유: TRIP-225 승인 테스트가 이 prop들 없이 화면을 세운다. 필수로
   * 올리면 그 동결 파일이 타입에서 깨진다(계약 확장이지 계약 변경이 아니다). */
  onFix?: (savedStayId: string) => void;
  onExtendConfirm?: (savedStayId: string) => void;
  onExtendCancel?: () => void;
  onBack: () => void;
  onAssign: (savedStayId: string) => void;
  onRetryAssign: (savedStayId: string) => void;
  onChange: (baseAssignmentId: string) => void;
  onRetryChange: (baseAssignmentId: string) => void;
  onGenerate: () => void;
  onNoStayStart: () => void;
  onExploreStays: () => void;
  onRetryAll: () => void;
  onRestart: () => void;
  onRetryCoverage: () => void;
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
      <View className="flex-row items-center gap-[6px]">
        <View className="h-1 w-[14px] rounded-[2px] bg-primary" />
        <View className="h-1 w-[14px] rounded-[2px] bg-primary" />
        <Text className="text-caption text-muted">2 / 2</Text>
      </View>
    </View>
  );
}

/** 온램프 배너 — 서버 응답과 무관해 loading에서도 그대로 선다(Figma `1707:1189`). */
function OnrampBanner(): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-md rounded-[14px] bg-surface-soft px-lg py-[14px]">
      <View className="h-10 w-10 items-center justify-center rounded-button border border-hairline bg-canvas">
        <BedGlyph size={22} tone="muted" />
      </View>
      <View className="flex-1 gap-[3px]">
        <Text className="font-noto-bold text-body font-bold text-ink">
          숙소는 나중에 정해도 돼요
        </Text>
        <Text className="font-noto text-caption text-muted">
          일정을 다 짜면 동선 기준으로 딱 맞는 숙소를 추천해 드려요
        </Text>
      </View>
    </View>
  );
}

/** 인라인 실패 한 줄 + 재시도(01b D13) — 얼굴을 갈아 끼우지 않고 그 자리에 덧붙인다.
 * 자리가 곧 대상 지시라 문구에 대상 이름을 넣지 않는다(TRIP-208 `StayImportRow` 선례). */
function InlineFailure({
  errorTestID,
  retryTestID,
  message,
  onRetry,
}: {
  errorTestID: string;
  retryTestID: string;
  message: string;
  onRetry: () => void;
}): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-sm">
      <Text
        testID={errorTestID}
        className="flex-1 font-noto text-caption text-primary-text"
      >
        {message}
      </Text>
      <Pressable
        testID={retryTestID}
        accessibilityRole="button"
        onPress={onRetry}
        hitSlop={8}
      >
        <Text className="font-noto-bold text-caption font-bold text-primary-text">
          {RETRY_LABEL}
        </Text>
      </Pressable>
    </View>
  );
}

function SectionRow({
  row,
  onChange,
  onRetryChange,
}: {
  row: BaseSectionRow;
  onChange: (baseAssignmentId: string) => void;
  onRetryChange: (baseAssignmentId: string) => void;
}): ReactElement {
  return (
    <View
      testID={`trip-base-section-${row.baseAssignmentId}`}
      className="w-full gap-[10px] rounded-[14px] border border-hairline bg-canvas p-md"
    >
      <View className="w-full flex-row items-center gap-sm">
        <View className="rounded-pill bg-primary-pale px-[10px] py-xs">
          <Text className="font-noto-bold text-caption font-bold text-primary-text">
            {row.nightLabel}
          </Text>
        </View>
        <Text className="font-noto text-caption text-muted">
          {row.dateLabel}
        </Text>
      </View>
      <View className="w-full flex-row items-center gap-[10px]">
        <View className="h-[44px] w-[44px] rounded-[10px] bg-surface-strong" />
        <View className="flex-1 gap-xs">
          <Text className="font-noto-bold text-body font-bold text-ink">
            {row.stayName}
          </Text>
          {/* Figma는 이 자리에 `해운대 · 350m`과 행 우측 끝에 `부산`을 그리지만, 그 세 값은
              `BaseSection`에 없다 — TRIP-224 D1이 "계약이 생긴 뒤"로 명시 이연했다. 플레이스홀더
              바를 두는 01b D2는 **후보 카드**를 가리키므로 여기엔 적용하지 않는다. */}
          <View className="flex-row items-center gap-[6px]">
            <View className="rounded-pill bg-primary-pale px-[7px] py-[2px]">
              <Text className="font-noto-bold text-micro font-bold text-primary-text">
                거점
              </Text>
            </View>
          </View>
        </View>
        <Pressable
          testID={`trip-base-change-${row.baseAssignmentId}`}
          accessibilityRole="button"
          disabled={row.changePending}
          onPress={() => onChange(row.baseAssignmentId)}
          className="flex-row items-center gap-[2px]"
          hitSlop={8}
        >
          <Text className="font-noto-bold text-label font-bold text-primary-text">
            변경
          </Text>
          <ChevronRightGlyph size={16} tone="primaryText" />
        </Pressable>
      </View>
      {row.errorText === undefined ? null : (
        <InlineFailure
          errorTestID={`trip-base-change-error-${row.baseAssignmentId}`}
          retryTestID={`trip-base-change-retry-${row.baseAssignmentId}`}
          message={row.errorText}
          onRetry={() => onRetryChange(row.baseAssignmentId)}
        />
      )}
    </View>
  );
}

function CandidateCard({
  candidate,
  onAssign,
  onRetryAssign,
  onFix,
  onExtendConfirm,
  onExtendCancel,
}: {
  candidate: BaseCandidateRow;
  onAssign: (savedStayId: string) => void;
  onRetryAssign: (savedStayId: string) => void;
  onFix?: (savedStayId: string) => void;
  onExtendConfirm?: (savedStayId: string) => void;
  onExtendCancel?: () => void;
}): ReactElement {
  return (
    <View
      testID={`trip-base-candidate-${candidate.savedStayId}`}
      className="w-full overflow-hidden rounded-card border border-hairline bg-canvas"
    >
      <View className="h-[164px] w-full bg-surface-strong">
        {candidate.isBase ? (
          <View
            testID={`trip-base-badge-${candidate.savedStayId}`}
            className="absolute left-md top-md flex-row items-center gap-xs rounded-pill bg-primary py-[5px] pl-[9px] pr-[11px]"
          >
            <BaseBadgePinGlyph />
            <Text className="font-noto-bold text-caption font-bold text-on-primary">
              거점
            </Text>
          </View>
        ) : null}
        <View className="absolute right-md top-[14px]">
          <HeartFilledGlyph />
        </View>
      </View>
      <View className="w-full gap-[7px] p-[14px]">
        <Text className="font-noto-bold text-[16px] font-bold text-ink">
          {candidate.name}
        </Text>
        <View className="h-[13px] w-[124px] rounded-[6px] bg-surface-strong" />
        <View className="h-[16px] w-[104px] rounded-[6px] bg-surface-strong" />
        <View className="h-px w-full bg-hairline" />
        {/* 기간 밖 경고는 카드 렌더 시점부터 상주한다(01b D8) — 누르고 나서야 알려 주면
            사용자는 이미 확장 질의를 마주한 뒤다. e05 conflict 안내행(`1358:1578`) 서식.
            ponytail: 그 프레임의 20px 아이콘(`1358:1579`)은 리포에 없고 모양도 미확정이라
            글자만 세운다 — 에셋이 들어오면 이 View에 한 줄 더하면 된다. */}
        {candidate.outOfPeriodNote === undefined ? null : (
          <View className="w-full flex-row items-center gap-[10px] rounded-button border border-info-border bg-info-bg px-[14px] py-md">
            <Text
              testID={`trip-base-outofperiod-${candidate.savedStayId}`}
              className="flex-1 font-noto text-label text-info"
            >
              {candidate.outOfPeriodNote}
            </Text>
          </View>
        )}
        {candidate.assignedLabel === undefined ? (
          <>
            <Pressable
              testID={`trip-base-assign-${candidate.savedStayId}`}
              accessibilityRole="button"
              disabled={
                candidate.blockedReason !== undefined || candidate.assignPending
              }
              onPress={() => onAssign(candidate.savedStayId)}
              className="flex-row items-center gap-[2px] self-start"
              hitSlop={8}
            >
              <Text className="font-noto-bold text-label font-bold text-primary-text">
                거점으로 지정
              </Text>
              <ChevronRightGlyph size={16} tone="primaryText" />
            </Pressable>
            {candidate.blockedReason === undefined ? null : (
              <Text
                testID={`trip-base-assign-blocked-${candidate.savedStayId}`}
                className="font-noto text-caption text-muted"
              >
                {candidate.blockedReason}
              </Text>
            )}
            {/* 225는 사유만 보이고 끝이라 막다른 길이었다 — 226이 더하는 것이 이 한 버튼이다.
                두 축(좌표·날짜)의 목적지가 같은 시트라 버튼도 하나이고 라벨만 갈린다.
                e05 보완 진입(`1358:1584`) 서식. */}
            {candidate.fixLabel === undefined ? null : (
              <Pressable
                testID={`trip-base-fix-${candidate.savedStayId}`}
                accessibilityRole="button"
                onPress={() => onFix?.(candidate.savedStayId)}
                className="h-12 w-full items-center justify-center rounded-button border border-hairline-strong bg-canvas"
              >
                <Text className="font-noto-bold text-card-title font-bold text-ink">
                  {candidate.fixLabel}
                </Text>
              </Pressable>
            )}
          </>
        ) : (
          <View className="flex-row items-center gap-[5px] self-start rounded-pill bg-primary-pale py-[5px] pl-[10px] pr-[11px]">
            <CheckGlyph />
            <Text
              testID={`trip-base-assigned-${candidate.savedStayId}`}
              className="font-noto-bold text-caption font-bold text-primary-text"
            >
              {candidate.assignedLabel}
            </Text>
          </View>
        )}
        {/* 확인·취소가 한 안내 안에 함께 선다 — 취소가 화면 저 멀리 있으면 질의가 아니라
            통보다(BR-U1-27). e05 error-mapapi 카드(`1359:1561`) 서식. */}
        {candidate.extendPrompt === undefined ? null : (
          <View
            testID={`trip-base-extendtrip-notice-${candidate.savedStayId}`}
            className="w-full gap-[10px] rounded-[14px] border border-hairline bg-surface-soft p-lg"
          >
            <View className="w-full flex-row items-center gap-sm">
              <WarningTriangleGlyph size={20} />
              <Text className="flex-1 font-noto-bold text-body font-bold text-ink">
                {candidate.extendPrompt}
              </Text>
            </View>
            <View className="w-full flex-row items-center gap-sm">
              <Pressable
                testID="trip-base-extendtrip-cancel"
                accessibilityRole="button"
                onPress={() => onExtendCancel?.()}
                className="h-12 flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
              >
                <Text className="font-noto-bold text-card-title font-bold text-muted">
                  {EXTEND_CANCEL_LABEL}
                </Text>
              </Pressable>
              <Pressable
                testID="trip-base-extendtrip-confirm"
                accessibilityRole="button"
                onPress={() => onExtendConfirm?.(candidate.savedStayId)}
                className="h-12 flex-1 items-center justify-center rounded-button bg-primary"
              >
                <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                  {EXTEND_CONFIRM_LABEL}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
        {candidate.errorText === undefined ? null : (
          <InlineFailure
            errorTestID={`trip-base-assign-error-${candidate.savedStayId}`}
            retryTestID={`trip-base-assign-retry-${candidate.savedStayId}`}
            message={candidate.errorText}
            onRetry={() => onRetryAssign(candidate.savedStayId)}
          />
        )}
      </View>
    </View>
  );
}

function SectionSkeleton({ index }: { index: number }): ReactElement {
  return (
    <View
      testID={`trip-base-skeleton-section-${index}`}
      className="w-full gap-[10px] rounded-[14px] border border-hairline bg-canvas p-md"
    >
      <View className="h-[20px] w-[64px] rounded-pill bg-surface-strong" />
      <View className="w-full flex-row items-center gap-md">
        <View className="h-[44px] w-[44px] rounded-[10px] bg-surface-strong" />
        <View className="flex-1 gap-sm">
          <View className="h-[14px] w-[185px] rounded-[6px] bg-hairline" />
          <View className="h-[12px] w-[139px] rounded-[6px] bg-surface-strong" />
        </View>
      </View>
    </View>
  );
}

function CardSkeleton({ index }: { index: number }): ReactElement {
  return (
    <View testID={`trip-base-skeleton-card-${index}`} className="w-full gap-sm">
      <View className="h-[178px] w-full rounded-card bg-surface-strong" />
      <View className="w-full gap-xs">
        <View className="h-[14px] w-[239px] rounded-[6px] bg-hairline" />
        <View className="h-[12px] w-[179px] rounded-[6px] bg-surface-strong" />
        <View className="h-[16px] w-[119px] rounded-[6px] bg-surface-strong" />
      </View>
    </View>
  );
}

/** 미해결 날짜 안내행(Figma `2456:1513`) — **해소 어포던스를 주지 않는다.** 겹침·공백을 푸는
 * 시트는 TRIP-190 몫이고, 디자인에도 버튼·셰브런이 0개다. 날짜는 한 `Text` 안에 중첩해
 * 그린다 — 정본 testID(`trip-base-coverage-day-{date}`)를 개별 날짜에 유지하면서 `·`로
 * 이어진 한 줄로도 읽히게 하는 유일한 형태다. */
function BlockedNotice({
  unresolved,
}: {
  unresolved: UnresolvedDaysView;
}): ReactElement {
  return (
    <View
      testID="trip-base-blocked-notice"
      className="w-full flex-row items-center gap-md rounded-[14px] bg-surface-soft px-lg py-[14px]"
    >
      <WarningTriangleGlyph size={20} />
      <View className="flex-1 gap-[3px]">
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          아직 정리되지 않은 날짜가 있어요
        </Text>
        <Text
          testID="trip-base-blocked-days"
          className="font-noto text-label text-muted"
        >
          {unresolved.items.map((item, index) => (
            <Text key={item.date}>
              {index === 0 ? '' : ' · '}
              <Text testID={`trip-base-coverage-day-${item.date}`}>
                {item.label}
              </Text>
            </Text>
          ))}
          {unresolved.overflowCount === 0 ? null : (
            <Text>
              {' · '}
              <Text testID="trip-base-blocked-more">
                {`외 ${unresolved.overflowCount}일`}
              </Text>
            </Text>
          )}
        </Text>
      </View>
    </View>
  );
}

/** 하단 CTA 묶음 — default·loading·blocked가 공유한다. 주 CTA는 받은 `generateDisabled`
 * 하나로만 갈리고, **보조 CTA는 어떤 실패에서도 활성이다**(BR-U1-40·47 · 01b D15). */
function CtaBlock({
  generateDisabled,
  coverageFailed,
  unresolved,
  onGenerate,
  onNoStayStart,
  onRetryCoverage,
}: Pick<
  TripWizardStep2ScreenProps,
  | 'generateDisabled'
  | 'coverageFailed'
  | 'unresolved'
  | 'onGenerate'
  | 'onNoStayStart'
  | 'onRetryCoverage'
>): ReactElement {
  return (
    <View className="w-full gap-md">
      {unresolved === undefined ? null : (
        <BlockedNotice unresolved={unresolved} />
      )}
      {coverageFailed ? (
        <InlineFailure
          errorTestID="trip-base-coverage-error"
          retryTestID="trip-base-coverage-retry"
          message={COVERAGE_ERROR_MESSAGE}
          onRetry={onRetryCoverage}
        />
      ) : null}
      <Pressable
        testID="trip-base-generate"
        accessibilityRole="button"
        disabled={generateDisabled}
        onPress={onGenerate}
        className={`w-full items-center justify-center rounded-button p-lg ${
          generateDisabled ? 'bg-hairline-strong' : 'bg-primary'
        }`}
      >
        <Text
          className={`font-noto-bold text-[16px] font-bold ${
            generateDisabled ? 'text-muted' : 'text-on-primary'
          }`}
        >
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
  );
}

export function TripWizardStep2Screen({
  variant,
  subtitle,
  sections,
  candidates,
  generateDisabled,
  unresolved,
  coverageFailed,
  fixSheet,
  onFix,
  onExtendConfirm,
  onExtendCancel,
  onBack,
  onAssign,
  onRetryAssign,
  onChange,
  onRetryChange,
  onGenerate,
  onNoStayStart,
  onExploreStays,
  onRetryAll,
  onRestart,
  onRetryCoverage,
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

        {variant === 'empty' ? (
          <View className="flex-1 items-center justify-center gap-xl px-2xl pb-[28px] pt-2xl">
            <View
              testID="trip-base-empty"
              className="w-full items-center gap-xl"
            >
              <View className="h-[124px] w-[124px] items-center justify-center rounded-pill bg-primary-pale">
                <BedGlyph size={52} tone="primaryText" />
              </View>
              <Text className="text-center font-noto-bold text-[20px] font-bold text-ink">
                숙소 없이 시작해도 돼요
              </Text>
              <Text className="text-center font-noto text-label leading-[20px] text-muted">
                {'일정을 다 짜면 동선 기준으로\n딱 맞는 숙소를 추천해 드려요'}
              </Text>
              <View className="w-full flex-row items-center gap-md rounded-[14px] bg-surface-soft px-lg py-[14px]">
                <View className="h-[38px] w-[38px] items-center justify-center rounded-button border border-hairline bg-canvas">
                  <PinGlyph size={20} />
                </View>
                <Text className="flex-1 font-noto text-label text-body">
                  이동 동선의 중심에서 가까운 숙소를 찾아드려요
                </Text>
              </View>
            </View>
            <View className="w-full gap-[10px]">
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
                testID="trip-base-explore-stays"
                accessibilityRole="button"
                onPress={onExploreStays}
                className="w-full flex-row items-center justify-center gap-sm rounded-button border border-hairline-strong bg-canvas px-lg py-[15px]"
              >
                <SearchGlyph />
                <Text className="font-noto-bold text-card-title font-bold text-ink">
                  숙소 둘러보기
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {variant === 'default' || loading ? (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingBottom: 26 }}
          >
            <View
              testID={loading ? 'trip-base-loading' : undefined}
              className="w-full gap-xl px-lg pt-[10px]"
            >
              <OnrampBanner />

              <View className="w-full gap-md">
                <View className="gap-xs">
                  <Text className="font-noto-bold text-[16px] font-bold text-ink">
                    어디서 묵을까요?
                  </Text>
                  <Text
                    className={
                      loading
                        ? 'font-noto text-label text-muted-soft'
                        : 'font-noto text-caption text-muted'
                    }
                  >
                    {loading ? '거점을 불러오는 중' : `박별 거점 · ${subtitle}`}
                  </Text>
                </View>
                <View className="w-full gap-[10px]">
                  {loading
                    ? [0, 1].map((index) => (
                        <SectionSkeleton key={index} index={index} />
                      ))
                    : sections.map((row) => (
                        <SectionRow
                          key={row.baseAssignmentId}
                          row={row}
                          onChange={onChange}
                          onRetryChange={onRetryChange}
                        />
                      ))}
                </View>
              </View>

              <View className="w-full gap-md">
                <View className="gap-[3px]">
                  <Text className="font-noto-bold text-[16px] font-bold text-ink">
                    숙소 후보
                  </Text>
                  <Text
                    className={
                      loading
                        ? 'font-noto text-label text-muted-soft'
                        : 'font-noto text-caption text-muted'
                    }
                  >
                    {loading
                      ? '숙소를 모으는 중'
                      : '마음에 드는 곳을 골라 박에 배정하세요'}
                  </Text>
                </View>
                <View className="w-full gap-lg">
                  {loading
                    ? [0, 1].map((index) => (
                        <CardSkeleton key={index} index={index} />
                      ))
                    : candidates.map((candidate) => (
                        <CandidateCard
                          key={candidate.savedStayId}
                          candidate={candidate}
                          onAssign={onAssign}
                          onRetryAssign={onRetryAssign}
                          onFix={onFix}
                          onExtendConfirm={onExtendConfirm}
                          onExtendCancel={onExtendCancel}
                        />
                      ))}
                </View>
              </View>
            </View>
          </ScrollView>
        ) : null}

        {/* TRIP-493 — 주 CTA(`이 거점으로 일정 만들기`)와 보조 CTA(`숙소 없이 시작하기`)를
            스크롤 밖 하단에 고정한다(step1 `[다음]`과 같은 규칙). 숙소 후보 카드가 많아도
            거점을 지정하고 다음으로 넘어가는 문이 카드 아래 파묻히지 않는다. default·loading
            두 얼굴이 공유하고, empty·error·notrip은 각자 자기 CTA를 갖는다(여기서 안 그린다). */}
        {variant === 'default' || loading ? (
          <View className="border-t border-hairline bg-canvas px-lg pb-[18px] pt-md">
            <CtaBlock
              generateDisabled={generateDisabled}
              coverageFailed={coverageFailed}
              unresolved={unresolved}
              onGenerate={onGenerate}
              onNoStayStart={onNoStayStart}
              onRetryCoverage={onRetryCoverage}
            />
          </View>
        ) : null}

        {/* 열렸을 때만 마운트한다 — 상시 마운트하면 목록만 보는 사용자에게도 매 렌더 WebView가
            따라붙는다. `key`로 숙소가 바뀌면 시트를 새로 세운다(앞 숙소의 지도 문서가 남지
            않게 한다). */}
        {fixSheet === undefined ? null : (
          <TripBaseFixSheet key={fixSheet.savedStayId} {...fixSheet} />
        )}
      </View>
    </SafeAreaView>
  );
}
