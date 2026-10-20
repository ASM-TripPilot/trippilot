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
import { ProposalCard } from './ProposalCard';
import { ActionRow, OutlineCard } from './OutlineCard';
import {
  ChevronRightGlyph,
  ExternalLinkGlyph,
  InfoGlyph,
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
  /** 제안 카드(TRIP-1324) — 없으면 PROPOSAL 메시지는 카드 없이 말풍선만. */
  proposal?: {
    applyingId: string | null;
    errors: Readonly<Record<string, string>>;
    onApply: (proposalId: string) => void;
    onDismiss: (proposalId: string) => void;
    onRepropose: (messageId: string) => void;
  };
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

// 아이콘(20) + 본문 한 줄 — 경고·안내 카드의 공통 골격. 색은 아이콘과 링크에만 둔다(TRIP-1528 공통 규칙).
const ICON_CARD = 'flex-row items-start gap-[10px] px-[14px] py-md';
const WARN = '#FF385C';

export function ReviewCard({
  payload,
  onPressAction,
}: {
  payload: ReviewPayload;
  onPressAction: (action: NextAction) => void;
}): ReactElement {
  return (
    <View testID="assistant-review-card" className="gap-md">
      <OutlineCard>
        <Text className="px-lg py-[10px] font-noto-bold text-card-title font-bold text-ink">
          {payload.title}
        </Text>
        <View className="h-px bg-hairline opacity-60" />
        <View className="gap-xs px-lg py-[6px]">
          {payload.summary.map((row, index) => (
            <View key={`${row.label}-${index}`} className="flex-row gap-md">
              <Text className="w-[40px] font-noto text-label text-muted">
                {row.label}
              </Text>
              <Text className="flex-1 font-noto text-body text-ink">
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      </OutlineCard>
      {payload.problems.map((problem, index) => (
        <OutlineCard
          key={`${problem.slotKey ?? 'p'}-${index}`}
          testID={`assistant-review-problem-${index}`}
          className={ICON_CARD}
        >
          <WarningGlyph size={20} color={WARN} />
          <View className="flex-1">
            <Text className="font-noto text-body text-ink">
              {problem.reason}
            </Text>
            <LinkLine
              testID={`assistant-review-fix-${index}`}
              label={problem.fixAction.label}
              tone="primary"
              onPress={() => onPressAction(problem.fixAction)}
            />
          </View>
        </OutlineCard>
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
    <View className="gap-md">
      {payload.candidates.map((candidate) => (
        <Pressable
          key={candidate.poiId}
          testID={`assistant-candidate-${candidate.poiId}`}
          accessibilityRole="button"
          onPress={() => onPick(candidate.poiId)}
        >
          <OutlineCard className="flex-row items-center gap-md px-[14px] py-md">
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
            <ChevronRightGlyph size={20} color="#6A6A6A" />
          </OutlineCard>
        </Pressable>
      ))}
    </View>
  );
}

export function InfoCard({ payload }: { payload: InfoPayload }): ReactElement {
  return (
    <OutlineCard testID="assistant-info-card" className="gap-sm px-lg py-md">
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        {payload.title}
      </Text>
      {payload.rows.map((row, index) => (
        <View key={`${row.label}-${index}`} className="flex-row gap-md">
          <Text className="w-[64px] font-noto text-label text-muted">
            {row.label}
          </Text>
          <Text className="flex-1 font-noto text-body text-ink">
            {row.value}
          </Text>
        </View>
      ))}
    </OutlineCard>
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
    <OutlineCard testID="assistant-scope-card">
      {otaAction ? (
        <Pressable
          testID="assistant-scope-ota"
          accessibilityRole="button"
          onPress={() => onPressAction(otaAction)}
          className="flex-row items-center gap-md px-[14px] py-md"
        >
          <View className="flex-1 gap-[2px]">
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {payload.alternative.title}
            </Text>
            <Text className="font-noto-bold text-label font-bold text-primary-text">
              {otaAction.label}
            </Text>
          </View>
          <ExternalLinkGlyph />
        </Pressable>
      ) : (
        <View className="gap-xs px-[14px] py-md">
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            {payload.alternative.title}
          </Text>
          <Text className="font-noto text-caption text-muted">
            {payload.alternative.caption}
          </Text>
        </View>
      )}
    </OutlineCard>
  );
}

export function RefusalNotice({
  payload,
}: {
  payload: RefusalPayload;
}): ReactElement {
  return (
    <OutlineCard testID="assistant-refusal" className={ICON_CARD}>
      <InfoGlyph size={20} />
      <Text
        testID="assistant-capabilities"
        className="flex-1 font-noto text-body text-ink"
      >
        {payload.capabilities}
      </Text>
    </OutlineCard>
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
    <View testID="assistant-fallback" className="gap-md">
      {payload.notice || retryAction ? (
        <OutlineCard className={ICON_CARD}>
          <WarningGlyph size={20} color={WARN} />
          <View className="flex-1 gap-xs">
            {payload.notice ? (
              <Text className="font-noto-bold text-body font-bold text-ink">
                {payload.notice}
              </Text>
            ) : null}
            {retryAction ? (
              <Pressable
                testID="assistant-fallback-retry"
                accessibilityRole="button"
                onPress={() => onPressAction(retryAction)}
                className="h-[52px] items-center justify-center rounded-button bg-primary"
              >
                {/* 킷 Button: 높이 52 · 글자 Bold 16 — 토큰에 없는 값이라 브래킷(Figma 5027:4816) */}
                <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
                  {retryAction.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </OutlineCard>
      ) : null}
      {/* BR-U8-41 — 원인과 무관하게 항상 있는 출구. 서버가 준 라벨이 있으면 그것, 없으면 기본 문구.
          다시 시도가 있는 응답 실패는 안내 카드 + 링크, 없는 솔버 불가 등은 한 줄 행 카드(Figma 5027:5106). */}
      {retryAction ? (
        <OutlineCard className={ICON_CARD}>
          <InfoGlyph size={20} />
          <View className="flex-1">
            <Text className="font-noto-bold text-body font-bold text-ink">
              도우미 없이도 계속할 수 있어요
            </Text>
            <LinkLine
              testID="assistant-fallback-continue"
              label={exit.label}
              tone="info"
              onPress={() => onPressAction(exit)}
            />
          </View>
        </OutlineCard>
      ) : (
        <ActionRow
          testID="assistant-fallback-continue"
          label={exit.label}
          onPress={() => onPressAction(exit)}
        />
      )}
    </View>
  );
}

// 진행 검토(REVIEW) 행과 태그 없는 행은 배지가 없다(Figma 5027:5297). 배지는 킷 Badge 모양: px 8 py 3 · 반경 12 · Bold 11.
const TAG_FACE: Partial<
  Record<ActionLogTag, { label: string; className: string; text: string }>
> = {
  FILTER: {
    label: '적용된 필터',
    className: 'bg-primary-pale',
    text: 'text-primary',
  },
  CHANGE: {
    label: '반영된 변경',
    className: 'bg-success-bg',
    text: 'text-success',
  },
};

export function ActionLogRow({
  testID,
  id,
  payload,
}: {
  testID: string;
  /** 행 id — 배지 testID(`assistant-badge-${id}`)가 행 testID 접두와 겹치지 않게 따로 받는다. */
  id: string;
  payload: ActionLogPayload;
}): ReactElement {
  const tag = payload.tag ? TAG_FACE[payload.tag] : undefined;
  return (
    <OutlineCard testID={testID} className="gap-xs px-[14px] py-md">
      <View className="flex-row items-center gap-sm">
        <Text className="flex-1 font-noto-bold text-body font-bold text-ink">
          {payload.what}
        </Text>
        {tag ? (
          <View
            testID={`assistant-badge-${id}`}
            className={`rounded-button px-sm py-[3px] ${tag.className}`}
          >
            <Text className={`font-noto-bold text-micro font-bold ${tag.text}`}>
              {tag.label}
            </Text>
          </View>
        ) : null}
      </View>
      {payload.detail ? (
        <Text className="font-noto text-label text-muted">
          {payload.detail}
        </Text>
      ) : null}
    </OutlineCard>
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

/** kind 별 카드 — 카드가 없는 kind(TEXT·CLARIFY)는 null. */
export function MessageCard({
  message,
  onPressAction,
  onPickCandidate,
  proposal,
}: { message: AssistantMessage } & MessageCardHandlers): ReactNode {
  if (message.kind === 'PROPOSAL') {
    if (!message.proposal || !proposal) return null;
    return (
      <ProposalCard
        proposal={message.proposal}
        applying={proposal.applyingId === message.proposal.id}
        errorText={proposal.errors[message.proposal.id] ?? null}
        onApply={proposal.onApply}
        onDismiss={proposal.onDismiss}
        onRepropose={() => proposal.onRepropose(message.id)}
      />
    );
  }
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
          id={message.id}
          payload={payload as ActionLogPayload}
        />
      );
    default:
      return null;
  }
}
