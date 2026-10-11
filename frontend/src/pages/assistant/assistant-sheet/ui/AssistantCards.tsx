import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import type {
  ActionLogPayload,
  ActionLogTag,
  AssistantMessage,
  CandidatesPayload,
  FallbackPayload,
  InfoPayload,
  NextAction,
  RefusalPayload,
  ReviewPayload,
  ScopePayload,
} from '../api/assistantContract';
import {
  ChevronRightGlyph,
  InfoGlyph,
  RetryGlyph,
  WarningGlyph,
} from './AssistantSheetGlyphs';

/**
 * 도우미 카드 7종(TRIP-1323) — 라이브 Figma b01 review · b03 scope · b04 guardrail · b05 error/solver-unavailable ·
 * b06 행. 카드는 서버 값(문구·시각·거리)을 그대로 그린다: 문제를 더 판정하지 않고(BR-U8-14) 시각을 추측하지
 * 않으며(BR-U8-42) 소요시간을 만들지 않는다(BR-U8-15 · INV-3). 순수 뷰 — 누름은 콜백으로만 올린다.
 */

export interface MessageCardHandlers {
  onPressAction: (action: NextAction) => void;
  onPickCandidate: (poiId: string) => void;
}

const CONTINUE_ACTION: NextAction = {
  type: 'CONTINUE_WITHOUT_ASSISTANT',
  label: '도우미 없이 계속',
  params: {},
};

function findAction(
  message: AssistantMessage,
  type: string
): NextAction | undefined {
  return message.nextActions.find((action) => action.type === type);
}

function LinkLine({
  testID,
  label,
  onPress,
  tone,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  tone: 'primary' | 'info';
}): ReactElement {
  const color = tone === 'primary' ? '#C13515' : '#0B6E63';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-xs self-start py-xs"
    >
      <Text
        className={`font-noto-bold text-label font-bold ${tone === 'primary' ? 'text-primary-text' : 'text-info'}`}
      >
        {label}
      </Text>
      <ChevronRightGlyph size={14} color={color} />
    </Pressable>
  );
}

export function ReviewCard({
  payload,
  onPressAction,
}: {
  payload: ReviewPayload;
  onPressAction: (action: NextAction) => void;
}): ReactElement {
  return (
    <View testID="assistant-review-card" className="gap-sm">
      <View className="gap-sm rounded-card bg-surface-soft px-lg py-lg">
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {payload.title}
        </Text>
        {payload.summary.map((row, index) => (
          <View key={`${row.label}-${index}`} className="flex-row gap-lg">
            <Text className="w-[40px] font-noto text-label text-muted">
              {row.label}
            </Text>
            <Text className="flex-1 font-noto text-label text-ink">
              {row.value}
            </Text>
          </View>
        ))}
      </View>
      {payload.problems.map((problem, index) => (
        <View
          key={`${problem.slotKey ?? 'p'}-${index}`}
          testID={`assistant-review-problem-${index}`}
          className="gap-xs rounded-card border border-primary-pale bg-primary-pale px-lg py-md"
        >
          <View className="flex-row items-start gap-sm">
            <WarningGlyph />
            <Text className="flex-1 font-noto text-label text-ink">
              {problem.reason}
            </Text>
          </View>
          <View className="pl-[26px]">
            <LinkLine
              testID={`assistant-review-fix-${index}`}
              label={problem.fixAction.label}
              tone="primary"
              onPress={() => onPressAction(problem.fixAction)}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export function CandidateCard({
  payload,
  onPick,
}: {
  payload: CandidatesPayload;
  onPick: (poiId: string) => void;
}): ReactElement {
  return (
    <View className="gap-sm">
      {payload.candidates.map((candidate) => (
        <Pressable
          key={candidate.poiId}
          testID={`assistant-candidate-${candidate.poiId}`}
          accessibilityRole="button"
          onPress={() => onPick(candidate.poiId)}
          className="flex-row items-center gap-md rounded-card border border-hairline bg-canvas px-lg py-md"
        >
          <View className="flex-1 gap-[3px]">
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {candidate.name}
            </Text>
            <Text className="font-noto text-caption text-muted">
              {[candidate.distanceRange, candidate.reason]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <ChevronRightGlyph size={18} color="#6A6A6A" />
        </Pressable>
      ))}
    </View>
  );
}

export function InfoCard({ payload }: { payload: InfoPayload }): ReactElement {
  return (
    <View
      testID="assistant-info-card"
      className="gap-sm rounded-card border border-hairline bg-canvas px-lg py-md"
    >
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        {payload.title}
      </Text>
      {payload.rows.map((row, index) => (
        <View key={`${row.label}-${index}`} className="flex-row gap-lg">
          <Text className="w-[64px] font-noto text-label text-muted">
            {row.label}
          </Text>
          <Text className="flex-1 font-noto text-label text-ink">
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function ScopeCard({
  payload,
  otaAction,
  onPressAction,
}: {
  payload: ScopePayload;
  otaAction?: NextAction;
  onPressAction: (action: NextAction) => void;
}): ReactElement | null {
  if (!payload.alternative) return null;
  return (
    <View
      testID="assistant-scope-card"
      className="gap-xs rounded-card border border-hairline bg-canvas px-lg py-md"
    >
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        {payload.alternative.title}
      </Text>
      {otaAction ? (
        <LinkLine
          testID="assistant-scope-ota"
          label={otaAction.label}
          tone="primary"
          onPress={() => onPressAction(otaAction)}
        />
      ) : (
        <Text className="font-noto text-caption text-muted">
          {payload.alternative.caption}
        </Text>
      )}
    </View>
  );
}

export function RefusalNotice({
  payload,
}: {
  payload: RefusalPayload;
}): ReactElement {
  return (
    <View
      testID="assistant-refusal"
      className="flex-row items-start gap-sm rounded-card border border-info-border bg-info-bg px-lg py-md"
    >
      <InfoGlyph />
      <Text
        testID="assistant-capabilities"
        className="flex-1 font-noto text-label text-info"
      >
        {payload.capabilities}
      </Text>
    </View>
  );
}

export function FallbackNotice({
  payload,
  retryAction,
  continueAction,
  onPressAction,
}: {
  payload: FallbackPayload;
  retryAction?: NextAction;
  continueAction?: NextAction;
  onPressAction: (action: NextAction) => void;
}): ReactElement {
  const exit = continueAction ?? CONTINUE_ACTION;
  return (
    <View testID="assistant-fallback" className="gap-sm">
      {payload.notice || retryAction ? (
        <View className="gap-md rounded-card border border-primary-pale bg-primary-pale px-lg py-md">
          {payload.notice ? (
            <View className="flex-row items-start gap-sm">
              <WarningGlyph />
              <Text className="flex-1 font-noto text-label text-ink">
                {payload.notice}
              </Text>
            </View>
          ) : null}
          {retryAction ? (
            <Pressable
              testID="assistant-fallback-retry"
              accessibilityRole="button"
              onPress={() => onPressAction(retryAction)}
              className="ml-[26px] flex-row items-center gap-xs self-start rounded-button bg-primary px-lg py-sm"
            >
              <RetryGlyph />
              <Text className="font-noto-bold text-label font-bold text-on-primary">
                {retryAction.label}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {/* BR-U8-41 — 원인과 무관하게 항상 있는 출구. 서버가 준 라벨이 있으면 그것, 없으면 기본 문구. */}
      <View className="gap-xs rounded-card border border-info-border bg-info-bg px-lg py-md">
        <View className="flex-row items-center gap-sm">
          <InfoGlyph />
          <Text className="flex-1 font-noto text-label text-ink">
            도우미 없이도 계속할 수 있어요
          </Text>
        </View>
        <View className="pl-[26px]">
          <LinkLine
            testID="assistant-fallback-continue"
            label={exit.label}
            tone="info"
            onPress={() => onPressAction(exit)}
          />
        </View>
      </View>
    </View>
  );
}

const TAG_FACE: Record<
  ActionLogTag,
  { label: string; className: string; text: string }
> = {
  FILTER: {
    label: '적용된 필터',
    className: 'bg-primary-pale',
    text: 'text-primary-text',
  },
  CHANGE: {
    label: '반영된 변경',
    className: 'border border-info-border bg-info-bg',
    text: 'text-info',
  },
  REVIEW: { label: '검토', className: 'bg-surface-strong', text: 'text-muted' },
};

export function ActionLogRow({
  testID,
  payload,
}: {
  testID: string;
  payload: ActionLogPayload;
}): ReactElement {
  const tag = payload.tag ? TAG_FACE[payload.tag] : null;
  return (
    <View
      testID={testID}
      className="gap-sm rounded-card border border-hairline bg-canvas px-lg py-md"
    >
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        {payload.what}
      </Text>
      {tag || payload.detail ? (
        <View className="flex-row flex-wrap items-center gap-sm">
          {tag ? (
            <View className={`rounded-[6px] px-sm py-[3px] ${tag.className}`}>
              <Text
                className={`font-noto-bold text-micro font-bold ${tag.text}`}
              >
                {tag.label}
              </Text>
            </View>
          ) : null}
          {payload.detail ? (
            <Text className="flex-1 font-noto text-caption text-muted">
              {payload.detail}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** 카드가 스스로 그리는 행동 — 아래 버튼 줄에서 빼 두 번 그리지 않는다. */
export function cardConsumes(message: AssistantMessage): string[] {
  if (message.kind === 'SCOPE') {
    const payload = message.payload as ScopePayload | null | undefined;
    return payload?.alternative ? ['OPEN_OTA'] : [];
  }
  if (message.kind === 'FALLBACK') {
    return ['RETRY_TURN', 'CONTINUE_WITHOUT_ASSISTANT'];
  }
  return [];
}

/** kind 별 카드 — 카드가 없는 kind(TEXT·CLARIFY)는 null. PROPOSAL 은 TRIP-1324. */
export function MessageCard({
  message,
  onPressAction,
  onPickCandidate,
}: { message: AssistantMessage } & MessageCardHandlers): ReactNode {
  const payload = message.payload;
  if (!payload && message.kind !== 'FALLBACK') return null;
  switch (message.kind) {
    case 'REVIEW':
      return (
        <ReviewCard
          payload={payload as ReviewPayload}
          onPressAction={onPressAction}
        />
      );
    case 'CANDIDATES':
      return (
        <CandidateCard
          payload={payload as CandidatesPayload}
          onPick={onPickCandidate}
        />
      );
    case 'INFO':
      return <InfoCard payload={payload as InfoPayload} />;
    case 'SCOPE':
      return (
        <ScopeCard
          payload={payload as ScopePayload}
          otaAction={findAction(message, 'OPEN_OTA')}
          onPressAction={onPressAction}
        />
      );
    case 'REFUSAL':
      return <RefusalNotice payload={payload as RefusalPayload} />;
    case 'FALLBACK':
      return (
        <FallbackNotice
          payload={
            (payload as FallbackPayload | null) ?? { cause: 'AI_UNAVAILABLE' }
          }
          retryAction={findAction(message, 'RETRY_TURN')}
          continueAction={findAction(message, 'CONTINUE_WITHOUT_ASSISTANT')}
          onPressAction={onPressAction}
        />
      );
    case 'ACTION_LOG':
      return (
        <ActionLogRow
          testID={`assistant-action-log-${message.id}`}
          payload={payload as ActionLogPayload}
        />
      );
    default:
      return null;
  }
}
