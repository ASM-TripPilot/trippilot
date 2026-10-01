import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';

import {
  REPLAN_DIRECTIVES,
  REPLAN_REASONS,
  type ReplanChoice,
} from '@/features/planb/config/replanChoices';
import { REPLAN_SCOPES } from '@/features/planb/model/replanScope';
import type { StartReplanRequestScope } from '@/shared/api/generated/schemas/startReplanRequestScope';

import { RiskWarningGlyph } from './PlanbGlyphs';

/**
 * TRIP-750 · i04 재계획 요청 시트("AI에게 맡길게요", Figma 4067:2427). 순수 시트 — props+콜백만 받고
 * 스토어·훅·라우터를 직접 import 하지 않는다.
 *
 * 섹션 순서: 왜 바꾸나요 → 바꿀 범위 → 어떻게 바꿀까요 → 직접 말하기 → CTA 1개.
 * `detected`(감지 트리거)가 있으면 사유 맨 앞에 감지 칩을 세우고, 그와 겹치는 정적 칩
 * (날씨 · 감지 칩이 대신하는 사유)은 숨긴다. 스크림 탭·아래로 끌기 → onClose.
 *
 * 바텀시트의 실제 열림/닫힘·딤 커버는 jest 무심판(통과형 목) — 6-b 실기 몫. 자유텍스트는
 * `BottomSheetTextInput` 이라 포커스 때 시트가 키보드 위로 올라간다(TRIP-990 #051 · D9, 실동작은 6-b).
 */

const SHEET_TITLE = '✦ AI에게 맡길게요';
const REASON_LABEL = '왜 바꾸나요 · 여러 개 가능';
const SCOPE_LABEL = '바꿀 범위';
const DIRECTIVE_LABEL = '어떻게 바꿀까요 · 지킬 것도 함께';
const FREETEXT_LABEL = '직접 말하기';
const FREETEXT_PLACEHOLDER = '예: 저녁은 광안리 야경 보이는 곳으로';
const SUBMIT_LABEL = 'AI가 다시 짜기';
const FREETEXT_MAX = 500;

// gorhom 기본 배경 라운드(15)를 Figma 시트 상단 r24 로 덮어쓴다(RiskDetailSheet 와 같은 자리).
const SHEET_BACKGROUND = {
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
} as const;

/** 감지 트리거 1개를 사유 칩 1개로 보여 줄 재료(문구 + 이 칩이 켜고 끄는 사유 key). */
export interface ReplanDetectedChip {
  label: string;
  reasonKey: string;
}

export interface ReplanRequestSheetProps {
  scope: StartReplanRequestScope;
  selectedReasons: string[];
  selectedDirectives: string[];
  freeText: string;
  /** 트리거로 들어왔을 때만 — 사유 맨 앞 감지 칩. */
  detected?: ReplanDetectedChip | null;
  onSelectScope: (scope: StartReplanRequestScope) => void;
  onToggleReason: (key: string) => void;
  onToggleDirective: (key: string) => void;
  onChangeFreeText: (text: string) => void;
  onSubmit: () => void;
  /** 스크림 탭 · 아래로 끌어 닫기. */
  onClose: () => void;
  /** 재계획 시작 실패 안내(INV-4 — 조용한 실패 금지). 없으면 안 그린다. */
  errorText?: string | null;
}

/**
 * Figma 칩 크기가 두 벌이다 — 작은 칩(#F2F2F2 · 12.5)과 큰 칩(#F7F7F7 · 13)이 방향 그룹 안에서도 섞여 있다.
 * 12.5 는 `text-caption`(12)로 붙인다 — `text-[12.5px] text-body` 는 CSS 순서상 `text-body` 의 글자 크기
 * (14)가 이겨 오히려 커진다(`body` 가 색이자 글자 크기 토큰).
 * 그룹 단위로 통일한다(브리프 Q5): 범위만 큰 칩. 방향 11개를 큰 칩으로 두면 390 폭에서 넷째 줄로
 * 넘쳐(Figma 3줄) 사유·방향 모두 작은 칩이다.
 */
type ChipSize = 'small' | 'large';

const CHIP_BOX: Record<ChipSize, string> = {
  small: 'px-md py-sm',
  large: 'px-[14px] py-[9px]',
};
const CHIP_IDLE_BG: Record<ChipSize, string> = {
  small: 'bg-surface-strong',
  large: 'bg-surface-soft',
};
const CHIP_IDLE_TEXT: Record<ChipSize, string> = {
  small: 'font-noto text-caption text-body',
  large: 'font-noto text-label text-ink',
};
const CHIP_SELECTED_TEXT: Record<ChipSize, string> = {
  small: 'font-noto-bold text-caption font-bold text-primary',
  large: 'font-noto-bold text-label font-bold text-primary',
};

/** 값 하나 = 누를 수 있는 칩. 선택되면 `accessibilityState.selected` + primary-pale 배경. */
function Chip({
  testID,
  label,
  selected,
  size,
  onToggle,
  icon,
}: {
  testID: string;
  label: string;
  selected: boolean;
  size: ChipSize;
  onToggle: () => void;
  icon?: ReactElement;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onToggle}
      className={`flex-row items-center gap-[5px] rounded-button ${CHIP_BOX[size]} ${
        selected ? 'bg-primary-pale' : CHIP_IDLE_BG[size]
      }`}
    >
      {icon}
      <Text
        className={selected ? CHIP_SELECTED_TEXT[size] : CHIP_IDLE_TEXT[size]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }): ReactElement {
  return (
    <Text className="font-noto-bold text-caption font-bold text-muted-soft">
      {children}
    </Text>
  );
}

function renderChoices(
  testIdPrefix: string,
  choices: ReplanChoice[],
  selected: string[],
  size: ChipSize,
  onToggle: (key: string) => void
): ReactElement[] {
  return choices.map((choice) => (
    <Chip
      key={choice.key}
      testID={`${testIdPrefix}-${choice.key}`}
      label={choice.label}
      selected={selected.includes(choice.key)}
      size={size}
      onToggle={() => onToggle(choice.key)}
    />
  ));
}

export function ReplanRequestSheet({
  scope,
  selectedReasons,
  selectedDirectives,
  freeText,
  detected,
  onSelectScope,
  onToggleReason,
  onToggleDirective,
  onChangeFreeText,
  onSubmit,
  onClose,
  errorText,
}: ReplanRequestSheetProps): ReactElement {
  // 감지 칩이 있으면 그와 겹치는 정적 칩(날씨 · 감지 칩이 대신하는 사유)을 숨긴다(브리프 Q2).
  const staticReasons = detected
    ? REPLAN_REASONS.filter(
        (reason) =>
          reason.key !== 'WEATHER' && reason.key !== detected.reasonKey
      )
    : REPLAN_REASONS;

  return (
    <BottomSheet
      enablePanDownToClose
      onClose={onClose}
      keyboardBehavior="interactive"
      backgroundStyle={SHEET_BACKGROUND}
      backdropComponent={() => (
        // 목/실라이브러리 모두 backdrop 에 prop 을 안 넘길 수 있어 onClose 를 클로저로 문다
        // (RiskDetailSheet 선례).
        <Pressable
          testID="planb-request-scrim"
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          className="absolute inset-0 bg-scrim/40"
        />
      )}
    >
      <BottomSheetScrollView
        testID="planb-request-sheet"
        // 입력 중 "AI가 다시 짜기" 첫 탭이 키보드 닫기에만 먹히지 않게(TRIP-990 Q10).
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="w-full gap-lg px-lg pb-2xl pt-sm"
      >
        <Text className="font-noto-bold text-[20px] font-bold text-ink">
          {SHEET_TITLE}
        </Text>

        {/* 왜 바꾸나요 — 다중. 감지 칩이 맨 앞 */}
        <View className="gap-sm">
          <Text className="font-noto-bold text-caption font-bold text-body">
            {REASON_LABEL}
          </Text>
          <View className="flex-row flex-wrap gap-sm">
            {detected ? (
              <Chip
                testID="planb-request-trigger-chip"
                label={detected.label}
                selected={selectedReasons.includes(detected.reasonKey)}
                size="small"
                onToggle={() => onToggleReason(detected.reasonKey)}
                icon={<RiskWarningGlyph size={11} />}
              />
            ) : null}
            {renderChoices(
              'planb-request-reason',
              staticReasons,
              selectedReasons,
              'small',
              onToggleReason
            )}
          </View>
        </View>

        {/* 바꿀 범위 — 단일 선택, 기본 지금 이후 */}
        <View className="gap-sm">
          <SectionLabel>{SCOPE_LABEL}</SectionLabel>
          <View className="flex-row gap-sm">
            {REPLAN_SCOPES.map((option) => (
              <Chip
                key={option.scope}
                testID={`planb-request-scope-${option.scope}`}
                label={option.label}
                selected={scope === option.scope}
                size="large"
                onToggle={() => onSelectScope(option.scope)}
              />
            ))}
          </View>
        </View>

        {/* 어떻게 바꿀까요 — 다중 */}
        <View className="gap-sm">
          <SectionLabel>{DIRECTIVE_LABEL}</SectionLabel>
          <View className="flex-row flex-wrap gap-sm">
            {renderChoices(
              'planb-request-directive',
              REPLAN_DIRECTIVES,
              selectedDirectives,
              'small',
              onToggleDirective
            )}
          </View>
        </View>

        {/* 직접 말하기 — 1줄 입력(Figma ≈44). 테두리는 라이브 #E3E3E3 의 가까운 토큰(Q6) */}
        <View className="gap-sm">
          <SectionLabel>{FREETEXT_LABEL}</SectionLabel>
          <BottomSheetTextInput
            testID="planb-request-freetext"
            value={freeText}
            onChangeText={onChangeFreeText}
            placeholder={FREETEXT_PLACEHOLDER}
            placeholderTextColor="#9AA1AB"
            maxLength={FREETEXT_MAX}
            className="h-[44px] rounded-input border border-hairline-strong bg-surface-soft px-[14px] font-noto text-label text-ink"
          />
        </View>

        {errorText ? (
          <Text
            testID="planb-request-error"
            className="font-noto text-label text-primary-text"
          >
            {errorText}
          </Text>
        ) : null}

        <Pressable
          testID="planb-request-submit"
          accessibilityRole="button"
          onPress={onSubmit}
          className="items-center justify-center rounded-button bg-primary py-[17px]"
        >
          <Text className="font-noto-bold text-card-title font-bold text-on-primary">
            {SUBMIT_LABEL}
          </Text>
        </Pressable>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
