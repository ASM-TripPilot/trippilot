import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Proposal, ProposalDiffItem } from '../api/assistantContract';
import { slotFaceLine } from '../model/cardModel';
import { CheckGlyph, WarningGlyph } from './AssistantSheetGlyphs';

/**
 * b02 전후 비교 카드(TRIP-1324 · BR-U8-30~35). 도우미 경로의 변경은 전부 제안이다 — [적용]을 눌러야만 저장된다.
 *
 * - [적용]은 `violations` 가 비었고 상태가 PROPOSED 일 때만 그린다. 위반 판정은 서버가 이미 했다 — 카드는 길이만
 *   본다(BR-U8-31, 클라 재판정 없음).
 * - 시각·거리는 diff 문자열 그대로(`slotFaceLine`), 이동은 거리만(BR-U8-35 · INV-3).
 * - 적용 중이면 [적용]을 막는다 — 이중 적용의 최종 차단은 서버 상태기계(INV-U8-08), 페이지 ref 잠금이 그 앞.
 * - STALE·EXPIRED·FAILED 면 버튼 대신 낡음 안내 + [다시 제안](같은 요청을 다시 보낸다).
 */

export interface ProposalCardProps {
  proposal: Proposal;
  applying: boolean;
  onApply: (proposalId: string) => void;
  onDismiss: (proposalId: string) => void;
  onRepropose: () => void;
  /** 적용이 거절됐지만 상태를 바꾸지 않은 경우(409 NOT_APPLICABLE·저장 실패)의 안내. */
  errorText?: string | null;
}

function DiffRow({
  badge,
  tone,
  line,
  checked,
}: {
  badge: string;
  tone: 'now' | 'next';
  line: string;
  checked?: boolean;
}): ReactElement {
  return (
    <View className="flex-row items-center gap-md py-md">
      <View
        className={`rounded-[6px] px-sm py-[3px] ${tone === 'now' ? 'bg-surface-strong' : 'bg-primary-pale'}`}
      >
        <Text
          className={`font-noto-bold text-micro font-bold ${tone === 'now' ? 'text-muted' : 'text-primary-text'}`}
        >
          {badge}
        </Text>
      </View>
      <Text className="flex-1 font-noto text-label text-ink">{line}</Text>
      {checked ? <CheckGlyph /> : null}
    </View>
  );
}

function DiffBlock({ item }: { item: ProposalDiffItem }): ReactElement {
  return (
    <View>
      {item.before ? (
        <DiffRow badge="지금" tone="now" line={slotFaceLine(item.before)} />
      ) : null}
      {item.before && item.after ? <View className="h-px bg-hairline" /> : null}
      {item.after ? (
        <DiffRow
          badge="변경"
          tone="next"
          line={slotFaceLine(item.after)}
          checked
        />
      ) : null}
    </View>
  );
}

const STATUS_TEXT: Partial<Record<Proposal['status'], string>> = {
  APPLIED: '적용했어요',
  DISMISSED: '취소했어요',
};

export function ProposalCard({
  proposal,
  applying,
  onApply,
  onDismiss,
  onRepropose,
  errorText,
}: ProposalCardProps): ReactElement {
  const open = proposal.status === 'PROPOSED';
  const stale =
    proposal.status === 'STALE' ||
    proposal.status === 'EXPIRED' ||
    proposal.status === 'FAILED';
  const applicable = open && proposal.violations.length === 0;

  return (
    <View testID={`assistant-proposal-${proposal.id}`} className="gap-sm">
      <View className="rounded-card bg-surface-soft px-lg">
        {proposal.diff.map((item, index) => (
          <DiffBlock key={`${item.slotKey}-${index}`} item={item} />
        ))}
      </View>

      {proposal.violations.map((violation, index) => (
        <View
          key={`${violation}-${index}`}
          testID={`assistant-proposal-violation-${index}`}
          className="flex-row items-start gap-sm rounded-card border border-primary-pale bg-primary-pale px-lg py-md"
        >
          <WarningGlyph />
          <Text className="flex-1 font-noto text-label text-ink">
            {violation}
          </Text>
        </View>
      ))}

      {stale ? (
        <View
          testID="assistant-proposal-stale"
          className="gap-sm rounded-card border border-hairline bg-canvas px-lg py-md"
        >
          <Text className="font-noto text-label text-ink">
            {proposal.status === 'FAILED'
              ? '적용하지 못했어요. 다시 제안할게요.'
              : '일정이 바뀌어 다시 제안할게요'}
          </Text>
          <Pressable
            testID="assistant-proposal-repropose"
            accessibilityRole="button"
            onPress={onRepropose}
            className="self-start rounded-button border border-hairline-strong bg-canvas px-[14px] py-sm"
          >
            <Text className="font-noto text-label text-ink">다시 제안</Text>
          </Pressable>
        </View>
      ) : null}

      {STATUS_TEXT[proposal.status] ? (
        <Text
          testID="assistant-proposal-status"
          className="font-noto-bold text-label font-bold text-muted"
        >
          {STATUS_TEXT[proposal.status]}
        </Text>
      ) : null}

      {errorText ? (
        <Text
          testID="assistant-proposal-error"
          className="font-noto text-label text-primary-text"
        >
          {errorText}
        </Text>
      ) : null}

      {open ? (
        <View className="flex-row gap-sm">
          {applicable ? (
            <Pressable
              testID="assistant-proposal-apply"
              accessibilityRole="button"
              accessibilityState={{ disabled: applying }}
              disabled={applying}
              onPress={() => onApply(proposal.id)}
              className={`flex-1 items-center rounded-button bg-primary py-[14px]${applying ? ' opacity-40' : ''}`}
            >
              <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                적용
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            testID="assistant-proposal-dismiss"
            accessibilityRole="button"
            disabled={applying}
            onPress={() => onDismiss(proposal.id)}
            className="flex-1 items-center rounded-button border border-hairline-strong bg-canvas py-[14px]"
          >
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              취소
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
