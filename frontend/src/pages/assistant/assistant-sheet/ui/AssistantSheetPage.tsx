import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, Text } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import {
  assistantHref,
  type AssistantSurface,
} from '@/features/open-assistant';
import type {
  AssistantMessage,
  NextAction,
  QuickReply,
  TurnInput,
} from '../api/assistantContract';
import { isAssistantApiError } from '../api/assistantPort';
import {
  useApplyProposal,
  useAssistantMessages,
  useAssistantSession,
  useAssistantSessions,
  useClearSession,
  useDismissProposal,
  useMarkProposal,
} from '../model/assistantQueries';
import { useAnswerFeedback } from '../model/useAnswerFeedback';
import { useTurnFlow } from '../model/useTurnFlow';
import { CAPABILITIES_LABEL, displayMessage } from '../model/displayActions';
import { nextActionRoute } from '../model/nextActionRoute';
import { resolveSheetState } from '../model/resolveSheetState';
import {
  currentQuickReplies,
  isSendableText,
  needsCapabilitiesChip,
} from '../model/sheetModel';
import { AnswerFeedback } from './AnswerFeedback';
import { MessageCard } from './AssistantCards';
import { TurnStatusRow } from './AssistantSheetChrome';
import { AssistantSheetView } from './AssistantSheetView';
import { HistoryView } from './HistoryView';

/**
 * b01~b07 도우미 시트 배선판(TRIP-1322). 세션 열기 → 판정 1회(`resolveSheetState`) → 순수 뷰.
 *
 * - 문맥은 라우트가 넘긴 `surface`·`tripId` 뿐이다(BR-U8-02). 여행 없이 열면 b07(일반 도움 모드, 비활성 아님).
 * - 세션 생성 401 이면 시트를 닫는다(`/assistant` 는 `(tabs)` 밖이라 guard 에 안 걸린다 — frontend-components §1).
 * - next action: 갈 수 있는 것만 그리고(`displayActions`), 누르면 시트 자리를 그 화면으로 **replace** 한다 —
 *   모달을 닫고 push 하는 두 걸음 대신 한 걸음(FD §4-5 와 다름, 개정 블록).
 * - "내가 할 수 있는 것 보기" 상시 칩: 서버가 그 quick reply 를 줬으면 그것을 ACTION 으로, 아니면 라벨을
 *   TEXT 턴으로 보낸다 — 클라가 quick reply id 를 지어내지 않는다(위조 차단 규칙).
 * - 답 평가(US-ASSIST-09): 도우미 답 아래 엄지 줄. 평가 값은 메시지 캐시(낙관 갱신·실패 롤백), 펼친 이유 칸·
 *   쓰던 의견·실패 안내는 `useAnswerFeedback` 이 쥔다.
 */

export interface AssistantSheetPageProps {
  surface: AssistantSurface;
  tripId?: string;
}

export function AssistantSheetPage({
  surface,
  tripId,
}: AssistantSheetPageProps): ReactElement {
  const router = useRouter();
  const tripKey = tripId ?? null;
  const session = useAssistantSession(tripKey);
  const sessionId = session.data?.session.id;
  const messagesQuery = useAssistantMessages(sessionId);
  const applyProposal = useApplyProposal(sessionId, tripKey);
  const dismissProposal = useDismissProposal(sessionId);
  const markProposal = useMarkProposal(sessionId);
  const clearSession = useClearSession(tripKey);
  const [draft, setDraft] = useState('');
  const turn = useTurnFlow(sessionId, surface, setDraft);
  const feedback = useAnswerFeedback(sessionId);
  // 이력 보기(b06) — 별도 라우트가 아니라 시트 안 보기 전환(깜빡임 없이, frontend-components §1).
  const [view, setView] = useState<'CHAT' | 'HISTORY'>('CHAT');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const sessions = useAssistantSessions();
  // 적용 중인 제안 id — 화면 비활성과 ref 잠금 둘 다. 이중 적용의 최종 차단은 서버 상태기계(INV-U8-08).
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const applyingRef = useRef(false);
  const [proposalErrors, setProposalErrors] = useState<Record<string, string>>(
    {}
  );

  const state = resolveSheetState({
    status: session.status,
    error: session.error,
    session: session.data?.session,
  });

  const closingRef = useRef(false);
  function handleClose(): void {
    if (closingRef.current) return;
    closingRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as Href);
  }

  // 401 — 열 수 없는 사람에게 빈 시트를 남기지 않는다.
  useEffect(() => {
    if (state === 'UNAUTHORIZED') handleClose();
    // handleClose 는 ref 로 한 번만 동작한다 — 의존성은 판정 결과뿐이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const ctx = { tripId: tripKey, surface };
  const rawMessages: readonly AssistantMessage[] =
    messagesQuery.data?.messages ?? session.data?.messages ?? [];
  // 보내는 중·보내지 못한 턴의 사용자 말풍선(낙관) — 서버 응답이 오면 진짜 USER 메시지로 바뀐다.
  const pendingBubble: AssistantMessage[] = turn.pending
    ? [
        {
          id: 'pending',
          role: 'USER',
          kind: 'TEXT',
          text: turn.pending.text,
          nextActions: [],
          createdAt: '',
        },
      ]
    : [];
  const messages = [...rawMessages, ...pendingBubble].map((message) =>
    displayMessage(message, ctx)
  );
  const quickReplies = currentQuickReplies(
    rawMessages,
    session.data?.quickReplies ?? []
  );

  const blocked = turn.inFlight || turn.rateLimitedSeconds > 0;

  function send(input: TurnInput, text: string): void {
    if (!sessionId || blocked) return;
    turn.send(input, text);
  }

  function sendText(text: string): void {
    send({ type: 'TEXT', text }, text);
  }

  function handleSend(): void {
    if (!isSendableText(draft) || blocked) return;
    const text = draft.trim();
    setDraft('');
    sendText(text);
  }

  function handleQuickReply(reply: QuickReply): void {
    send({ type: 'ACTION', quickReplyId: reply.id }, reply.label);
  }

  function handleCapabilities(): void {
    const issued = quickReplies.find(
      (reply) => reply.action === 'SHOW_CAPABILITIES'
    );
    if (issued) {
      send({ type: 'ACTION', quickReplyId: issued.id }, issued.label);
    } else {
      sendText(CAPABILITIES_LABEL);
    }
  }

  // 후보 카드 — 서버가 그 후보에 발급한 PICK_CANDIDATE quick reply 로만 보낸다(id 를 지어내지 않는다).
  function handlePickCandidate(poiId: string): void {
    const picked = rawMessages
      .flatMap((message) => message.quickReplies ?? [])
      .find(
        (reply) =>
          reply.action === 'PICK_CANDIDATE' && reply.params.poiId === poiId
      );
    if (picked) send({ type: 'ACTION', quickReplyId: picked.id }, picked.label);
  }

  function handleApply(proposalId: string): void {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplyingId(proposalId);
    applyProposal.mutate(proposalId, {
      onError: (error) => {
        // 409 STALE·EXPIRED — 서버가 이미 그 상태로 옮겼다. 카드를 낡음으로(BR-U8-32).
        if (
          isAssistantApiError(error) &&
          (error.code === 'STALE' || error.code === 'EXPIRED')
        ) {
          markProposal(proposalId, error.code);
          return;
        }
        setProposalErrors((prev) => ({
          ...prev,
          [proposalId]:
            isAssistantApiError(error) && error.code === 'NOT_APPLICABLE'
              ? '이 제안은 지금 적용할 수 없어요'
              : '적용하지 못했어요. 잠시 후 다시 시도해 주세요',
        }));
      },
      onSettled: () => {
        applyingRef.current = false;
        setApplyingId(null);
      },
    });
  }

  function handleDismiss(proposalId: string): void {
    if (applyingRef.current || dismissProposal.isPending) return;
    dismissProposal.mutate(proposalId);
  }

  // [다시 제안] — 그 제안을 부른 사용자 요청을 새 턴으로 다시 보낸다(클라가 quick reply 를 짓지 않는다).
  function handleRepropose(messageId: string): void {
    const index = rawMessages.findIndex((message) => message.id === messageId);
    for (let i = index - 1; i >= 0; i -= 1) {
      const message = rawMessages[i];
      if (message.role === 'USER' && message.text) {
        sendText(message.text);
        return;
      }
    }
  }

  function handleConfirmClear(): void {
    if (!sessionId || clearSession.isPending) return;
    clearSession.mutate(sessionId, {
      onSuccess: () => {
        setConfirmingClear(false);
        setView('CHAT');
      },
    });
  }

  function lastUserText(): string | null {
    for (let i = rawMessages.length - 1; i >= 0; i -= 1) {
      const message = rawMessages[i];
      if (message.role === 'USER' && message.text) return message.text;
    }
    return null;
  }

  function handleAction(action: NextAction): void {
    const target = nextActionRoute(action, ctx);
    if (target === null) return;
    if (target.kind === 'route') {
      if (closingRef.current) return;
      closingRef.current = true;
      router.replace(target.href as Href);
      return;
    }
    switch (target.action) {
      case 'CONTINUE_WITHOUT_ASSISTANT':
        handleClose();
        return;
      case 'SHOW_CAPABILITIES':
        handleCapabilities();
        return;
      case 'RETRY_TURN': {
        const text = lastUserText();
        if (text) sendText(text);
        return;
      }
    }
  }

  return (
    <AssistantSheetView
      state={state}
      contextChip={session.data?.session.contextChip ?? null}
      messages={messages}
      quickReplies={quickReplies}
      showCapabilitiesChip={needsCapabilitiesChip(quickReplies)}
      draft={draft}
      canSend={isSendableText(draft) && !blocked}
      onChangeDraft={setDraft}
      onSend={handleSend}
      onPressQuickReply={handleQuickReply}
      onPressCapabilities={handleCapabilities}
      onPressAction={handleAction}
      onClose={handleClose}
      onRetryOpen={() => void session.refetch()}
      repliesDisabled={blocked}
      sendTestID={turn.inFlight ? 'assistant-send-pending' : 'assistant-send'}
      statusRow={
        <TurnStatusRow
          sending={turn.inFlight}
          slow={turn.slow}
          failed={turn.pending?.status === 'FAILED'}
          rateLimitedSeconds={turn.rateLimitedSeconds}
          onCancel={turn.cancel}
          onResend={turn.resend}
        />
      }
      headerTrailing={
        <Pressable
          testID="assistant-history-toggle"
          accessibilityRole="button"
          accessibilityState={{ selected: view === 'HISTORY' }}
          onPress={() =>
            setView((prev) => (prev === 'CHAT' ? 'HISTORY' : 'CHAT'))
          }
          hitSlop={8}
        >
          <Text className="font-noto text-label text-muted">
            {view === 'HISTORY' ? '대화' : '이력'}
          </Text>
        </Pressable>
      }
      body={
        view === 'HISTORY' ? (
          <HistoryView
            logs={rawMessages.filter(
              (message) => message.kind === 'ACTION_LOG'
            )}
            otherSessions={(sessions.data ?? []).filter(
              (item) => item.id !== sessionId
            )}
            confirmingClear={confirmingClear}
            clearing={clearSession.isPending}
            onContinue={() => setView('CHAT')}
            onRequestClear={() => setConfirmingClear(true)}
            onCancelClear={() => setConfirmingClear(false)}
            onConfirmClear={handleConfirmClear}
            onOpenSession={(item) =>
              router.replace(assistantHref(surface, item.tripId) as Href)
            }
            onOpenChangeHistory={
              tripId
                ? () =>
                    router.replace(
                      `/trips/${encodeURIComponent(tripId)}/itinerary/history` as Href
                    )
                : undefined
            }
          />
        ) : undefined
      }
      renderCard={(message) => (
        <MessageCard
          message={message}
          onPressAction={handleAction}
          onPickCandidate={handlePickCandidate}
          proposal={{
            applyingId,
            errors: proposalErrors,
            onApply: handleApply,
            onDismiss: handleDismiss,
            onRepropose: handleRepropose,
          }}
        />
      )}
      renderFeedback={(message) => (
        <AnswerFeedback
          messageId={message.id}
          rating={message.feedback ?? null}
          panel={feedback.panelOf(message.id)}
          busy={feedback.busyOf(message.id)}
          error={feedback.errorOf(message.id)}
          onPressThumb={(rating) => feedback.pressThumb(message, rating)}
          onPickReason={(reason) => feedback.pickReason(message.id, reason)}
          onOpenComment={() => feedback.openComment(message.id)}
          onChangeComment={(text) => feedback.changeComment(message.id, text)}
          onSubmitComment={() => feedback.submitComment(message.id)}
        />
      )}
    />
  );
}
