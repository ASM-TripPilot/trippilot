import { useEffect, useRef, useState } from 'react';
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { assistantPort } from '../api/assistantClient';
import type {
  AssistantMessage,
  FeedbackRating,
  FeedbackRequest,
  MessagesPage,
  ProposalStatus,
  SendTurnRequest,
} from '../api/assistantContract';

/**
 * 도우미 서버 상태 훅(TRIP-1319, frontend-components §3·§6). 서버 정본은 Query 캐시 하나다 —
 * 화면 로컬 상태(보기 전환·입력·타이머)는 훅 밖(페이지)에 둔다.
 *
 * 메시지 목록은 `messages` 키 하나가 소유한다. 세션 열기 응답의 직전 메시지로 씨를 뿌리고, 턴·적용
 * 응답을 id 중복 없이 뒤에 붙인다(같은 응답을 두 번 받아도 한 번 — 멱등 재전송, INV-U8-05).
 */

export const assistantKeys = {
  session: (tripId: string | null) =>
    ['assistant', 'session', tripId ?? 'general'] as const,
  messages: (sessionId: string) =>
    ['assistant', 'messages', sessionId] as const,
  sessions: () => ['assistant', 'sessions'] as const,
};

/** id 기준으로 새 메시지만 뒤에 붙인다(순서 보존). */
export function appendMessages(
  current: readonly AssistantMessage[],
  incoming: readonly AssistantMessage[]
): AssistantMessage[] {
  const seen = new Set(current.map((message) => message.id));
  return [...current, ...incoming.filter((message) => !seen.has(message.id))];
}

/**
 * 재조회 합치기 — 새 id 는 뒤에 붙이고, 겹치는 id 는 **`proposal` 칸만** 응답값으로 바꾼다(서버가 옮긴 제안 상태 반영).
 * 응답 `proposal` 이 없으면 캐시를 둔다. 평가·문장 등 다른 칸은 캐시 그대로(낙관 갱신 보호).
 * 한 번 결정된 제안(PROPOSED 가 아닌 상태)은 응답의 PROPOSED 로 되돌리지 않는다 — [적용] 보다 먼저 떠난
 * 재조회의 옛 스냅샷이 늦게 도착해 APPLIED 를 PROPOSED 로 되감던 경쟁(5-b W-2).
 */
function mergeReopened(
  current: readonly AssistantMessage[],
  incoming: readonly AssistantMessage[]
): AssistantMessage[] {
  const fresh = new Map(incoming.map((message) => [message.id, message]));
  const refreshed = current.map((message) => {
    const proposal = fresh.get(message.id)?.proposal;
    if (!proposal) return message;
    const decided = message.proposal && message.proposal.status !== 'PROPOSED';
    if (decided && proposal.status === 'PROPOSED') return message;
    return { ...message, proposal };
  });
  return appendMessages(refreshed, incoming);
}

/** 옛 쪽 전체를 앞에 붙인다. 이미 캐시에 있는 id 는 **기존 것**을 둔다(낙관 갱신된 평가·제안 상태를 옛 값으로 되돌리지 않는다). */
export function prependMessages(
  older: readonly AssistantMessage[],
  current: readonly AssistantMessage[]
): AssistantMessage[] {
  const seen = new Set(current.map((message) => message.id));
  return [...older.filter((message) => !seen.has(message.id)), ...current];
}

function appendToCache(
  queryClient: QueryClient,
  sessionId: string,
  incoming: readonly AssistantMessage[]
): void {
  queryClient.setQueryData<MessagesPage>(
    assistantKeys.messages(sessionId),
    (page) => ({
      ...page,
      messages: appendMessages(page?.messages ?? [], incoming),
    })
  );
}

function patchProposalStatus(
  queryClient: QueryClient,
  sessionId: string,
  proposalId: string,
  status: ProposalStatus
): void {
  queryClient.setQueryData<MessagesPage>(
    assistantKeys.messages(sessionId),
    (page) =>
      page && {
        ...page,
        messages: page.messages.map((message) =>
          message.proposal?.id === proposalId
            ? { ...message, proposal: { ...message.proposal, status } }
            : message
        ),
      }
  );
}

/** 세션 열기(있으면 이어 열기 — 서버 멱등). 실패는 시트가 OPEN_FAILED 로 그리고 [다시 시도]로 refetch 한다. */
export function useAssistantSession(tripId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: assistantKeys.session(tripId),
    queryFn: async () => {
      const response = await assistantPort().openSession({ tripId });
      // 캐시가 이미 있으면(옛 쪽을 붙여 둔 뒤 재조회) 합친다 — 통째로 덮으면 붙인 옛 메시지와 낙관 갱신이 사라진다.
      queryClient.setQueryData<MessagesPage>(
        assistantKeys.messages(response.session.id),
        (page) =>
          page
            ? {
                ...page,
                messages: mergeReopened(page.messages, response.messages),
              }
            : {
                messages: response.messages,
                nextBefore: response.nextBefore ?? null,
              }
      );
      return response;
    },
    retry: false,
  });
}

export function useAssistantMessages(sessionId: string | undefined) {
  return useQuery({
    queryKey: assistantKeys.messages(sessionId ?? ''),
    queryFn: () => assistantPort().getMessages(sessionId ?? ''),
    enabled: sessionId !== undefined,
    // 세션 열기가 씨를 뿌린 캐시가 정본이다 — 화면이 다시 붙을 때마다 다시 묻지 않는다.
    staleTime: Infinity,
  });
}

export type OlderStatus = 'idle' | 'loading' | 'error';

/**
 * 이전 대화 더 보기. 캐시의 `nextBefore`(서버가 준 불투명 커서)를 그대로 `before` 로 보내고, 응답은 **도착
 * 시점의 최신 캐시** 앞에 붙인다(그 사이 온 턴 응답을 지우지 않는다). 진행 중 재호출은 ref 로 막는다 —
 * state 는 렌더 사이에만 갱신돼 같은 틱의 두 번째 호출을 못 막는다. 실패하면 캐시는 그대로, 다시 부르면 같은 커서.
 */
export function useLoadOlderMessages(sessionId: string | undefined): {
  hasMore: boolean;
  status: OlderStatus;
  loadOlder: () => void;
} {
  const queryClient = useQueryClient();
  const key = assistantKeys.messages(sessionId ?? '');
  // skipToken: 캐시를 구독만 하고 조회는 하지 않는다(씨는 세션 열기가 뿌린다).
  const { data } = useQuery<MessagesPage>({
    queryKey: key,
    queryFn: skipToken,
  });
  const [status, setStatus] = useState<OlderStatus>('idle');
  const busy = useRef(false);
  const current = useRef(sessionId);
  const hasMore = typeof data?.nextBefore === 'string';

  // 같은 Page 인스턴스에서 세션이 바뀌면(이력 → router.replace) 진행 표식·상태를 새로 시작한다(03b N1).
  useEffect(() => {
    current.current = sessionId;
    busy.current = false;
    setStatus('idle');
  }, [sessionId]);

  function loadOlder(): void {
    if (!sessionId || busy.current) return;
    const before = queryClient.getQueryData<MessagesPage>(key)?.nextBefore;
    if (typeof before !== 'string') return;
    busy.current = true;
    setStatus('loading');
    assistantPort()
      .getMessages(sessionId, { before })
      .then(
        (older) => {
          // 캐시가 그새 지워졌으면(이력 지우기) 새로 심지 않는다(03b W1).
          queryClient.setQueryData<MessagesPage>(
            key,
            (page) =>
              page && {
                messages: prependMessages(older.messages, page.messages),
                nextBefore: older.nextBefore ?? null,
              }
          );
          if (current.current === sessionId) setStatus('idle');
        },
        () => {
          if (current.current === sessionId) setStatus('error');
        }
      )
      .finally(() => {
        // 세션이 바뀐 뒤 늦게 끝난 이전 요청이 새 세션의 진행 표식을 풀지 않게 한다.
        if (current.current === sessionId) busy.current = false;
      });
  }

  return { hasMore, status, loadOlder };
}

export function useAssistantSessions() {
  return useQuery({
    queryKey: assistantKeys.sessions(),
    queryFn: () => assistantPort().listSessions(),
  });
}

export interface SendTurnVariables {
  request: SendTurnRequest;
  signal?: AbortSignal;
}

export function useSendTurn(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ request, signal }: SendTurnVariables) =>
      assistantPort().sendTurn(sessionId ?? '', request, { signal }),
    onSuccess: (response) => {
      if (sessionId) appendToCache(queryClient, sessionId, response.messages);
    },
  });
}

/** 일정 쿼리 전부(`/trips/{id}/itinerary…` 로 시작하는 키) — 뒤 화면이 새 값으로 다시 그려진다(§4-4). */
function invalidateItinerary(queryClient: QueryClient, tripId: string): void {
  const prefix = `/trips/${tripId}/itinerary`;
  void queryClient.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === 'string' &&
      query.queryKey[0].startsWith(prefix),
  });
}

export function useApplyProposal(
  sessionId: string | undefined,
  tripId: string | null
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) =>
      assistantPort().applyProposal(proposalId),
    onSuccess: (response) => {
      if (!sessionId) return;
      patchProposalStatus(
        queryClient,
        sessionId,
        response.proposal.id,
        response.proposal.status
      );
      appendToCache(queryClient, sessionId, response.messages);
      if (tripId) invalidateItinerary(queryClient, tripId);
    },
  });
}

export function useDismissProposal(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) =>
      assistantPort().dismissProposal(proposalId),
    onSuccess: (response) => {
      if (sessionId) {
        patchProposalStatus(
          queryClient,
          sessionId,
          response.proposal.id,
          response.proposal.status
        );
      }
    },
  });
}

/** 낡음·만료 응답(409)을 받은 제안을 카드에서 그 상태로 바꾼다 — 서버가 이미 상태를 옮겼다. */
export function useMarkProposal(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  return (proposalId: string, status: ProposalStatus) => {
    if (sessionId)
      patchProposalStatus(queryClient, sessionId, proposalId, status);
  };
}

export function useClearSession(tripId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => assistantPort().clearSession(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.removeQueries({
        queryKey: assistantKeys.messages(sessionId),
      });
      void queryClient.invalidateQueries({
        queryKey: assistantKeys.session(tripId),
      });
      void queryClient.invalidateQueries({
        queryKey: assistantKeys.sessions(),
      });
    },
  });
}

function feedbackOf(
  queryClient: QueryClient,
  sessionId: string,
  messageId: string
): FeedbackRating | null {
  return (
    queryClient
      .getQueryData<MessagesPage>(assistantKeys.messages(sessionId))
      ?.messages.find((message) => message.id === messageId)?.feedback ?? null
  );
}

function patchFeedback(
  queryClient: QueryClient,
  sessionId: string,
  messageId: string,
  feedback: FeedbackRating | null
): void {
  queryClient.setQueryData<MessagesPage>(
    assistantKeys.messages(sessionId),
    (page) =>
      page && {
        ...page,
        messages: page.messages.map((message) =>
          message.id === messageId ? { ...message, feedback } : message
        ),
      }
  );
}

export interface FeedbackVariables {
  messageId: string;
  /** null 이면 평가 취소(DELETE). */
  request: FeedbackRequest | null;
}

/**
 * 답 평가 남기기·바꾸기·취소(US-ASSIST-09). 메시지 캐시의 `feedback` 을 **응답 전에** 고치고(낙관), 실패하면
 * 누르기 전 값으로 되돌린다 — 안내는 부르는 쪽 몫(침묵 실패 금지). 성공하면 서버 값(PUT 응답의 rating, 취소는
 * null)으로 다시 맞춘다. 세션 재조회(`useAssistantSession` queryFn)는 캐시에 있는 메시지를 덮지 않고 새 것만 붙이므로
 * 낙관 값이 재조회에 지워지지 않는다. 이유·의견은 캐시에 싣지 않는다(메시지 응답에 없는 칸).
 * 같은 메시지에 요청이 겹치면 되돌릴 값이 꼬인다 — 부르는 쪽이 메시지마다 하나씩만 보낸다(`useAnswerFeedback`).
 */
export function useMessageFeedback(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      messageId,
      request,
    }: FeedbackVariables): Promise<FeedbackRating | null> => {
      if (request === null) {
        await assistantPort().deleteFeedback(sessionId ?? '', messageId);
        return null;
      }
      const saved = await assistantPort().putFeedback(
        sessionId ?? '',
        messageId,
        request
      );
      return saved.rating;
    },
    onMutate: ({ messageId, request }: FeedbackVariables) => {
      if (!sessionId) return undefined;
      const previous = feedbackOf(queryClient, sessionId, messageId);
      patchFeedback(queryClient, sessionId, messageId, request?.rating ?? null);
      return { previous };
    },
    onSuccess: (rating, { messageId }) => {
      if (sessionId) patchFeedback(queryClient, sessionId, messageId, rating);
    },
    onError: (_error, { messageId }, context) => {
      if (sessionId && context) {
        patchFeedback(queryClient, sessionId, messageId, context.previous);
      }
    },
  });
}
