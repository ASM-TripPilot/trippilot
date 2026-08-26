import type { ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import {
  REPLAN_DIRECTIVES,
  REPLAN_REASONS,
  REPLAN_SCOPES,
  type ReplanChoice,
} from '@/features/planb/model/replanScope';
import type { StartReplanRequestScope } from '@/shared/api/generated/schemas/startReplanRequestScope';

import { OutOfScopeNotice } from './OutOfScopeNotice';

/**
 * TRIP-439 · i10 재계획 요청 시트("AI에게 맡길게요"). 순수 시트 — props+콜백만 받고 스토어·훅·
 * 라우터를 직접 import 하지 않는다(SlotTimeSheet·ItineraryEditScreen 선례).
 *
 * 무엇을 보장하나:
 *  - 범위 2칩(단일 선택)·사유 6칩·방향 7칩(다중)·자유텍스트·2 CTA 가 규약 testID 로 실재.
 *  - 칩 press → 대응 콜백(그 key 로). `[AI가 다시 짜기]`↔`[직접 고르기]`는 서로 다른 콜백(페이지 분기 seam).
 *  - `outOfScope` 면 인라인 안내를 렌더하고 기본 CTA 를 비활성화한다(제출 잠금은 페이지가 한 번 더 진다).
 *  - 감지 배너+[끄기]는 `trigger` 가 있을 때만(자동 진입 변형). 수동 진입 주 동선엔 없다(D5).
 *
 * 바텀시트의 실제 열림/닫힘·딤 커버는 jest 무심판(통과형 목) — 6-b 실기 스모크 몫. 그래서 계약을
 * "제출→콜백"으로 잠근다. 자유텍스트는 목이 `BottomSheetTextInput` 을 안 줘서 플레인 RN `TextInput`.
 */

const SHEET_TITLE = '✦ AI에게 맡길게요';
const SHEET_SUBTITLE = '어디를 · 어떻게 바꿀지 알려주세요';
const SCOPE_LABEL = '바꿀 범위';
const REASON_LABEL = '왜 바꾸나요 (선택)';
const DIRECTIVE_LABEL = '어떻게 바꿀까요 (선택)';
const FREETEXT_LABEL = '직접 말하기';
const FREETEXT_PLACEHOLDER = '예: 저녁은 광안리 야경 보이는 곳으로';
const FOOTNOTE = '· 방문한 곳과 진행 중인 일정은 그대로 둡니다';
const SUBMIT_LABEL = 'AI가 다시 짜기';
const MANUAL_LABEL = '직접 고르기';
const SUPPRESS_LABEL = '끄기';
const FREETEXT_MAX = 500;

/** 감지 배너 데이터(자동 진입 변형에서만 내려온다, D5). */
export interface ReplanDetectionBanner {
  title: string;
}

export interface ReplanRequestSheetProps {
  scope: StartReplanRequestScope;
  selectedReasons: string[];
  selectedDirectives: string[];
  freeText: string;
  onSelectScope: (scope: StartReplanRequestScope) => void;
  onToggleReason: (key: string) => void;
  onToggleDirective: (key: string) => void;
  onChangeFreeText: (text: string) => void;
  onSubmit: () => void;
  onManual: () => void;
  /** 서버가 "바꿀 수 없는 요청"으로 판정하면 안내 렌더 + 기본 CTA 비활성. 기본 false. */
  outOfScope?: boolean;
  /** 있을 때만 감지 배너+[끄기]를 그린다(자동 진입). */
  trigger?: ReplanDetectionBanner;
  onSuppress?: () => void;
}

function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** 값 하나 = 누를 수 있는 칩. 선택되면 `accessibilityState.selected` + primary-pale 배경. */
function Chip({
  testID,
  label,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`rounded-pill px-[14px] py-[9px] ${
        selected ? 'bg-primary-pale' : 'bg-surface-soft'
      }`}
    >
      <Text
        className={`text-label ${
          selected
            ? 'font-noto-bold font-bold text-primary-text'
            : 'font-noto text-ink'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** 라벨 + 다중선택 칩 묶음(사유·방향 공용). */
function ChoiceGroup({
  label,
  testIdPrefix,
  choices,
  selected,
  onToggle,
}: {
  label: string;
  testIdPrefix: string;
  choices: ReplanChoice[];
  selected: string[];
  onToggle: (key: string) => void;
}): ReactElement {
  return (
    <View className="gap-sm">
      <Text className="font-noto-bold text-caption font-bold text-muted-soft">
        {label}
      </Text>
      <View className="flex-row flex-wrap gap-sm">
        {choices.map((choice) => (
          <Chip
            key={choice.key}
            testID={`${testIdPrefix}-${choice.key}`}
            label={choice.label}
            selected={selected.includes(choice.key)}
            onPress={() => onToggle(choice.key)}
          />
        ))}
      </View>
    </View>
  );
}

export function ReplanRequestSheet({
  scope,
  selectedReasons,
  selectedDirectives,
  freeText,
  onSelectScope,
  onToggleReason,
  onToggleDirective,
  onChangeFreeText,
  onSubmit,
  onManual,
  outOfScope = false,
  trigger,
  onSuppress,
}: ReplanRequestSheetProps): ReactElement {
  return (
    <BottomSheet backdropComponent={renderBackdrop}>
      <BottomSheetScrollView
        testID="planb-request-sheet"
        className="w-full gap-lg px-lg pb-2xl pt-sm"
      >
        {/* 헤더 */}
        <View className="gap-xs">
          <Text className="font-noto-bold text-section font-bold text-ink">
            {SHEET_TITLE}
          </Text>
          <Text className="font-noto text-label text-muted-soft">
            {SHEET_SUBTITLE}
          </Text>
        </View>

        {/* 바꿀 범위 — 단일 선택, 기본 지금 이후 */}
        <View className="gap-sm">
          <Text className="font-noto-bold text-caption font-bold text-muted-soft">
            {SCOPE_LABEL}
          </Text>
          <View className="flex-row gap-sm">
            {REPLAN_SCOPES.map((option) => (
              <Chip
                key={option.scope}
                testID={`planb-request-scope-${option.scope}`}
                label={option.label}
                selected={scope === option.scope}
                onPress={() => onSelectScope(option.scope)}
              />
            ))}
          </View>
        </View>

        {/* 감지 배너 — 자동 진입(trigger)일 때만 */}
        {trigger ? (
          <View
            testID="planb-request-detected"
            className="flex-row items-center gap-sm rounded-input bg-primary-pale px-[14px] py-[12px]"
          >
            <Text className="flex-1 font-noto-bold text-label font-bold text-primary-text">
              {`☂ ${trigger.title}`}
            </Text>
            <Pressable
              testID="planb-request-suppress"
              accessibilityRole="button"
              onPress={onSuppress}
            >
              <Text className="font-noto text-caption text-muted-soft">
                {SUPPRESS_LABEL}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* 왜 바꾸나요 (선택) — 다중 */}
        <ChoiceGroup
          label={REASON_LABEL}
          testIdPrefix="planb-request-reason"
          choices={REPLAN_REASONS}
          selected={selectedReasons}
          onToggle={onToggleReason}
        />

        {/* 어떻게 바꿀까요 (선택) — 다중 */}
        <ChoiceGroup
          label={DIRECTIVE_LABEL}
          testIdPrefix="planb-request-directive"
          choices={REPLAN_DIRECTIVES}
          selected={selectedDirectives}
          onToggle={onToggleDirective}
        />

        {/* 직접 말하기 — 플레인 RN TextInput(BottomSheetTextInput 은 목 미제공) */}
        <View className="gap-sm">
          <Text className="font-noto-bold text-caption font-bold text-muted-soft">
            {FREETEXT_LABEL}
          </Text>
          <TextInput
            testID="planb-request-freetext"
            value={freeText}
            onChangeText={onChangeFreeText}
            placeholder={FREETEXT_PLACEHOLDER}
            placeholderTextColor="#9AA1AB"
            maxLength={FREETEXT_MAX}
            multiline
            className="min-h-[64px] rounded-input border border-hairline-strong bg-surface-soft px-md py-sm font-noto text-label text-ink"
          />
        </View>

        {/* 범위 밖 판정이면 인라인 안내(표시만) */}
        {outOfScope ? <OutOfScopeNotice /> : null}

        {/* 각주 */}
        <Text className="font-noto text-micro text-muted-soft">{FOOTNOTE}</Text>

        {/* 기본 CTA — 범위 밖이면 비활성(회색). 실 잠금은 페이지 핸들러가 한 번 더 진다. */}
        <Pressable
          testID="planb-request-submit"
          accessibilityRole="button"
          disabled={outOfScope}
          onPress={onSubmit}
          className={`items-center justify-center rounded-[14px] py-[17px] ${
            outOfScope ? 'bg-hairline' : 'bg-primary'
          }`}
        >
          <Text
            className={`font-noto-bold text-card-title font-bold ${
              outOfScope ? 'text-muted-soft' : 'text-on-primary'
            }`}
          >
            {SUBMIT_LABEL}
          </Text>
        </Pressable>

        {/* 세컨더리 CTA — [직접 고르기]는 API 오류가 아니어도 항상 선택 가능(BR-U4-16) */}
        <Pressable
          testID="planb-request-manual"
          accessibilityRole="button"
          onPress={onManual}
          className="items-center justify-center rounded-[14px] border border-hairline-strong py-[15px]"
        >
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            {MANUAL_LABEL}
          </Text>
        </Pressable>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
