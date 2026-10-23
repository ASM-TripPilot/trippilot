import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Proposal, ProposalDiffItem } from '../api/assistantContract';
import { slotFaceLine } from '../model/cardModel';
import { CheckGlyph, WarningGlyph } from './AssistantSheetGlyphs';
import { OutlineCard } from './OutlineCard';

/**
 * b02 전후 비교 카드(TRIP-1324 · BR-U8-30~35). 도우미 경로의 변경은 전부 제안이다 — [적용]을 눌러야만 저장된다.
 *
 * - [적용]은 `violations` 가 비었고 상태가 PROPOSED 일 때만 그린다. 위반 판정은 서버가 이미 했다 — 카드는 길이만
 *   본다(BR-U8-31, 클라 재판정 없음).
 * - 시각·거리는 diff 문자열 그대로(`slotFaceLine`), 이동은 거리만(BR-U8-35 · INV-3).
 * - 적용 중이면 [적용]을 막는다 — 이중 적용의 최종 차단은 서버 상태기계(INV-U8-08), 페이지 ref 잠금이 그 앞.
 * - STALE·EXPIRED·FAILED 면 버튼 대신 낡음 안내 + [다시 제안](같은 요청을 다시 보낸다).
 * - 줄에 `dayLabel` 이 오면(여러 날을 통째로 바꾼 안 등) 날마다 머리 줄 + 카드 한 장으로 끊는다 — 한 날 안이어도
 *   라벨이 오면 그 날 머리 줄이 붙는다. 라벨이 하나도 없으면(옛 서버) 예전처럼 카드 한 장.
 *   빠지는 곳은 "빠짐"(지금 줄을 흐리게), 새로 넣는 곳은 "추가".
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
  dimmed,
}: {
  badge: string;
  tone: 'now' | 'next';
  line: string;
  checked?: boolean;
  dimmed?: boolean;
}): ReactElement {
  // 바뀌는 쪽("변경") 행만 면을 칠하고 체크를 단다 — 지금 쪽은 평범한 행(Figma 5026:3490)
  // 빠지는 곳은 흐리게 — 재계획 초안의 빠지는 곳(ReplanDraftView)과 같은 opacity-45
  const next = tone === 'next';
  return (
    <View
      className={`flex-row items-center gap-md px-lg py-md${next ? ' bg-primary-pale' : ''}${dimmed ? ' opacity-45' : ''}`}
    >
      <Text
        className={`w-[32px] font-noto text-label ${next ? 'font-noto-bold font-bold text-primary' : 'text-muted'}`}
      >
        {badge}
      </Text>
      <Text
        className={`flex-1 text-body text-ink ${next ? 'font-noto-bold font-bold' : 'font-noto'}`}
      >
        {line}
      </Text>
      {checked ? <CheckGlyph size={20} /> : null}
    </View>
  );
}

function DiffBlock({ item }: { item: ProposalDiffItem }): ReactElement {
  const removed = item.change === 'REMOVED';
  return (
    <View>
      {item.before ? (
        <DiffRow
          badge={removed ? '빠짐' : '지금'}
          tone="now"
          line={slotFaceLine(item.before)}
          dimmed={removed}
        />
      ) : null}
      {item.before && item.after ? <View className="h-px bg-hairline" /> : null}
      {item.after ? (
        <DiffRow
          badge={item.change === 'ADDED' ? '추가' : '변경'}
          tone="next"
          line={slotFaceLine(item.after)}
          checked
        />
      ) : null}
    </View>
  );
}

function DiffCard({ items }: { items: ProposalDiffItem[] }): ReactElement {
  return (
    <OutlineCard>
      {items.map((item, index) => (
        <DiffBlock key={`${item.slotKey}-${index}`} item={item} />
      ))}
    </OutlineCard>
  );
}

/**
 * 받은 순서 그대로, `dayLabel` 이 바뀌는 자리에서만 끊는다 — 같은 날이 떨어져 와도 합치지 않는다(앱이 줄 순서를
 * 바꾸지 않는다, INV-2). 빈 문자열·null 은 라벨 없음.
 */
function dayRuns(
  diff: ProposalDiffItem[]
): { label: string | null; items: ProposalDiffItem[] }[] {
  const runs: { label: string | null; items: ProposalDiffItem[] }[] = [];
  for (const item of diff) {
    const label = item.dayLabel || null;
    const last = runs[runs.length - 1];
    if (last && last.label === label) last.items.push(item);
    else runs.push({ label, items: [item] });
  }
  return runs;
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
    <View testID={`assistant-proposal-${proposal.id}`} className="gap-md">
      {proposal.diff.some((item) => item.dayLabel) ? (
        dayRuns(proposal.diff).map((run, runIndex) =>
          run.label ? (
            <View
              key={runIndex}
              // n 은 묶음 순번이다 — 몇째 날이 아니다(같은 날이 떨어져 오면 새 번호)
              testID={`assistant-proposal-day-${runIndex}`}
              className="gap-xs"
            >
              <Text className="font-noto-bold text-label font-bold text-muted">
                {run.label}
              </Text>
              <DiffCard items={run.items} />
            </View>
          ) : (
            <DiffCard key={runIndex} items={run.items} />
          )
        )
      ) : (
        <DiffCard items={proposal.diff} />
      )}

      {proposal.violations.map((violation, index) => (
        <OutlineCard
          key={`${violation}-${index}`}
          testID={`assistant-proposal-violation-${index}`}
          className="flex-row items-start gap-[10px] px-[14px] py-md"
        >
          <WarningGlyph size={20} color="#FF385C" />
          <Text className="flex-1 font-noto text-body text-ink">
            {violation}
          </Text>
        </OutlineCard>
      ))}

      {stale ? (
        <OutlineCard
          testID="assistant-proposal-stale"
          className="gap-sm px-[14px] py-md"
        >
          <Text className="font-noto text-body text-ink">
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
        </OutlineCard>
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
              className={`h-[52px] flex-1 items-center justify-center rounded-button bg-primary${applying ? ' opacity-40' : ''}`}
            >
              {/* 킷 Button: 높이 52 · 글자 Bold 16 — 토큰에 없는 값이라 브래킷(Figma 5026:3490) */}
              <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
                적용
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            testID="assistant-proposal-dismiss"
            accessibilityRole="button"
            disabled={applying}
            onPress={() => onDismiss(proposal.id)}
            className="h-[52px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-[16px] font-bold text-ink">
              취소
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
