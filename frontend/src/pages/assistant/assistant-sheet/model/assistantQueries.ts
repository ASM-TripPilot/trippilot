import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { assistantPort } from '../api/assistantClient';
import type {
  AssistantMessage,
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
