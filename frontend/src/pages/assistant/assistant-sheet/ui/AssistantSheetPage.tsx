import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useRouter, type Href } from 'expo-router';

import type { AssistantSurface } from '@/features/open-assistant';
import type {
  AssistantMessage,
  NextAction,
  QuickReply,
  TurnInput,
} from '../api/assistantContract';
import {
  useAssistantMessages,
  useAssistantSession,
  useSendTurn,
} from '../model/assistantQueries';
import { newClientTurnId } from '../model/clientTurnId';
import { CAPABILITIES_LABEL, displayActions } from '../model/displayActions';
import { nextActionRoute } from '../model/nextActionRoute';
import { resolveSheetState } from '../model/resolveSheetState';
import {
  currentQuickReplies,
  isSendableText,
  needsCapabilitiesChip,
} from '../model/sheetModel';
import { AssistantSheetView } from './AssistantSheetView';

/**
 * b01~b07 도우미 시트 배선판(TRIP-1322). 세션 열기 → 판정 1회(`resolveSheetState`) → 순수 뷰.
 *
 * - 문맥은 라우트가 넘긴 `surface`·`tripId` 뿐이다(BR-U8-02). 여행 없이 열면 b07(일반 도움 모드, 비활성 아님).
 * - 세션 생성 401 이면 시트를 닫는다(`/assistant` 는 `(tabs)` 밖이라 guard 에 안 걸린다 — frontend-components §1).
 * - next action: 갈 수 있는 것만 그리고(`displayActions`), 누르면 시트 자리를 그 화면으로 **replace** 한다 —
 *   모달을 닫고 push 하는 두 걸음 대신 한 걸음(FD §4-5 와 다름, 개정 블록).
 * - "내가 할 수 있는 것 보기" 상시 칩: 서버가 그 quick reply 를 줬으면 그것을 ACTION 으로, 아니면 라벨을
 *   TEXT 턴으로 보낸다 — 클라가 quick reply id 를 지어내지 않는다(위조 차단 규칙).
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
  const sendTurn = useSendTurn(sessionId);
  const [draft, setDraft] = useState('');

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
  const messages = rawMessages.map((message) =>
    message.role === 'ASSISTANT'
      ? { ...message, nextActions: displayActions(message.nextActions, ctx) }
      : message
  );
  const quickReplies = currentQuickReplies(
    rawMessages,
    session.data?.quickReplies ?? []
  );

  function send(input: TurnInput): void {
    if (!sessionId || sendTurn.isPending) return;
    sendTurn.mutate({
      request: { clientTurnId: newClientTurnId(), input, screen: { surface } },
    });
  }

  function handleSend(): void {
    if (!isSendableText(draft)) return;
    send({ type: 'TEXT', text: draft.trim() });
    setDraft('');
  }

  function handleQuickReply(reply: QuickReply): void {
    send({ type: 'ACTION', quickReplyId: reply.id });
  }

  function handleCapabilities(): void {
    const issued = quickReplies.find(
      (reply) => reply.action === 'SHOW_CAPABILITIES'
    );
    send(
      issued
        ? { type: 'ACTION', quickReplyId: issued.id }
        : { type: 'TEXT', text: CAPABILITIES_LABEL }
    );
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
        if (text) send({ type: 'TEXT', text });
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
      canSend={isSendableText(draft) && !sendTurn.isPending}
      onChangeDraft={setDraft}
      onSend={handleSend}
      onPressQuickReply={handleQuickReply}
      onPressCapabilities={handleCapabilities}
      onPressAction={handleAction}
      onClose={handleClose}
      onRetryOpen={() => void session.refetch()}
      repliesDisabled={sendTurn.isPending}
    />
  );
}
