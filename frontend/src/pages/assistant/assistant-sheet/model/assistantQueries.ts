import {
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
      queryClient.setQueryData<MessagesPage>(
        assistantKeys.messages(response.session.id),
        { messages: response.messages, nextBefore: null }
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
 * null)으로 다시 맞춘다 — 응답 전에 세션 재조회(`useAssistantSession` queryFn)가 같은 캐시를 통째로 덮어 낙관 값이
 * 지워져도 서버 값으로 돌아온다. 이유·의견은 캐시에 싣지 않는다(메시지 응답에 없는 칸).
 * 같은 메시지에 요청이 겹치면 되돌릴 값이 꼬인다 — 부르는 쪽이 메시지마다 하나씩만 보낸다(`useAnswerFeedback`).
 *
 * ponytail: 재조회가 평가 저장 **전에** 읽고 평가 응답보다 **늦게** 도착하면 낡은 값이 남는다 — 다음 재조회가 고친다.
 * 실제로 보이면 세션 queryFn 이 그동안 평가가 오간 메시지의 `feedback` 을 덮지 않게 한다.
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
