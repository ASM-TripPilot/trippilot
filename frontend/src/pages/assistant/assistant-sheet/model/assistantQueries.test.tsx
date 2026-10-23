import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import fc from 'fast-check';

import { setAssistantPort } from '../api/assistantClient';
import type {
  AssistantMessage,
  FeedbackRequest,
  FeedbackResponse,
  MessagesPage,
  OpenSessionResponse,
  Proposal,
} from '../api/assistantContract';
import { AssistantApiError, type AssistantPort } from '../api/assistantPort';
import {
  assistantSample,
  sampleTranscript,
  userMessage,
} from '../api/assistantSamples';
import {
  appendMessages,
  assistantKeys,
  prependMessages,
  useAssistantSession,
  useClearSession,
  useDismissProposal,
  useLoadOlderMessages,
  useMessageFeedback,
  useSendTurn,
} from './assistantQueries';

/**
 * TRIP-1319 — 훅은 `AssistantPort` 만 안다(교체 지점 1곳): 어댑터를 아무 구현으로 바꿔 끼워도
 * 훅 코드는 그대로 그 구현을 부른다. 키는 frontend-components §3 그대로.
 */

function stubPort(overrides: Partial<AssistantPort> = {}): AssistantPort {
  const reject = () => Promise.reject(new Error('unused'));
  return {
    openSession: jest.fn(() => Promise.resolve(sampleTranscript('greeting'))),
    listSessions: jest.fn(() => Promise.resolve([])),
    getMessages: jest.fn(reject),
    sendTurn: jest.fn(reject),
    applyProposal: jest.fn(reject),
    dismissProposal: jest.fn(reject),
    clearSession: jest.fn(reject),
    putFeedback: jest.fn(reject),
    deleteFeedback: jest.fn(reject),
    ...overrides,
  };
}

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

let restore: (() => void) | undefined;
const clients: QueryClient[] = [];
function newClient(): QueryClient {
  // gcTime Infinity — 기본 5분 gc 타이머가 테스트 뒤에도 남아 jest 가 끝나지 않는다.
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  clients.push(client);
  return client;
}
afterEach(() => {
  restore?.();
  clients.splice(0).forEach((client) => client.clear());
});

describe('도우미 훅 (TRIP-1319)', () => {
  it('교체성 · 끼운 어댑터를 부르고 세션 키·메시지 키에 응답을 담는다', async () => {
    const port = stubPort();
    restore = setAssistantPort(port);
    const client = newClient();

    const { result } = renderHook(() => useAssistantSession('trip-1'), {
      wrapper: wrapperWith(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(port.openSession).toHaveBeenCalledWith({ tripId: 'trip-1' });
    expect(client.getQueryData(assistantKeys.session('trip-1'))).toBeDefined();
    const seeded = client.getQueryData<{ messages: unknown[] }>(
      assistantKeys.messages(result.current.data?.session.id ?? '')
    );
    expect(seeded?.messages).toEqual(result.current.data?.messages);
  });

  it('여행 없는 세션 키는 general 이다', () => {
    expect(assistantKeys.session(null)).toEqual([
      'assistant',
      'session',
      'general',
    ]);
  });

  it('턴 응답을 메시지 캐시 뒤에 붙인다', async () => {
    const turnReply = sampleTranscript('weather');
    const port = stubPort({
      sendTurn: jest.fn(() =>
        Promise.resolve({
          messages: turnReply.messages,
          quickReplies: turnReply.quickReplies,
        })
      ),
    });
    restore = setAssistantPort(port);
    const client = newClient();
    client.setQueryData(assistantKeys.messages('s1'), {
      messages: [userMessage('old', '안녕')],
    });

    const { result } = renderHook(() => useSendTurn('s1'), {
      wrapper: wrapperWith(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        request: {
          clientTurnId: 'c1',
          input: { type: 'TEXT', text: '날씨' },
          screen: { surface: 'LIVE' },
        },
      });
    });

    expect(port.sendTurn).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ clientTurnId: 'c1' }),
      { signal: undefined }
    );
    const page = client.getQueryData<{ messages: { id: string }[] }>(
      assistantKeys.messages('s1')
    );
    expect(page?.messages.map((m) => m.id)).toEqual([
      'old',
      ...turnReply.messages.map((m) => m.id),
    ]);
  });

  it('appendMessages 는 이미 있는 id 를 다시 붙이지 않는다(멱등 재전송)', () => {
    const a = userMessage('a', '1');
    const b = userMessage('b', '2');
    expect(appendMessages([a], [a, b]).map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('답 평가 훅 (US-ASSIST-09)', () => {
  function feedbackIn(client: QueryClient, messageId: string) {
    return client
      .getQueryData<MessagesPage>(assistantKeys.messages('s1'))
      ?.messages.find((message) => message.id === messageId)?.feedback;
  }

  it('응답 전에 메시지 캐시를 먼저 고치고(낙관), 실패하면 이전 값으로 되돌린다', async () => {
    // Arrange — 응답을 붙잡아 두는 PUT
    let fail: (error: unknown) => void = () => undefined;
    const port = stubPort({
      putFeedback: jest.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            fail = reject;
          })
      ),
    });
    restore = setAssistantPort(port);
    const client = newClient();
    client.setQueryData<MessagesPage>(assistantKeys.messages('s1'), {
      messages: [
        { ...assistantSample('greeting', { id: 'a1' }), feedback: null },
      ],
    });
    const { result } = renderHook(() => useMessageFeedback('s1'), {
      wrapper: wrapperWith(client),
    });

    // Act — 좋아요
    act(() => {
      result.current.mutate({
        messageId: 'a1',
        request: { rating: 'UP', reason: null, comment: null },
      });
    });

    // Assert — 응답 전인데 이미 UP, 서버에는 본문 그대로
    await waitFor(() =>
      expect(port.putFeedback).toHaveBeenCalledWith('s1', 'a1', {
        rating: 'UP',
        reason: null,
        comment: null,
      })
    );
    expect(feedbackIn(client, 'a1')).toBe('UP');

    // Act — 실패 응답
    await act(async () => {
      fail(new AssistantApiError('SERVER'));
    });

    // Assert — 되돌림
    await waitFor(() => expect(feedbackIn(client, 'a1')).toBeNull());
  });

  it('취소(request null)는 DELETE 를 부르고 캐시의 평가를 지운다', async () => {
    const port = stubPort({
      deleteFeedback: jest.fn(() => Promise.resolve()),
    });
    restore = setAssistantPort(port);
    const client = newClient();
    client.setQueryData<MessagesPage>(assistantKeys.messages('s1'), {
      messages: [
        { ...assistantSample('greeting', { id: 'a1' }), feedback: 'DOWN' },
      ],
    });
    const { result } = renderHook(() => useMessageFeedback('s1'), {
      wrapper: wrapperWith(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ messageId: 'a1', request: null });
    });

    expect(port.deleteFeedback).toHaveBeenCalledWith('s1', 'a1');
    expect(port.putFeedback).not.toHaveBeenCalled();
    expect(feedbackIn(client, 'a1')).toBeNull();
  });

  // 세션 재조회(`useAssistantSession` queryFn)는 같은 메시지 캐시를 통째로 덮는다 — 평가 응답 전에 끼면 낙관 값이 지워진다.
  it.each([
    {
      call: 'PUT',
      stored: null,
      request: { rating: 'UP', reason: null, comment: null },
      saved: 'UP',
    },
    { call: 'DELETE', stored: 'UP', request: null, saved: null },
  ] as const)(
    '$call 응답 전에 세션 재조회가 캐시를 덮어도, 성공하면 서버 값($saved)으로 다시 맞춘다',
    async ({ stored, request, saved }) => {
      // Arrange — 재조회는 저장 전에 읽은 값(stored)을 주고, 평가 요청은 응답을 붙잡아 둔다
      let settle: () => void = () => undefined;
      function held<T>(value: T): Promise<T> {
        return new Promise<T>((resolve) => {
          settle = () => resolve(value);
        });
      }
      const port = stubPort({
        openSession: jest.fn(() =>
          Promise.resolve({
            session: { id: 's1', tripId: 'trip-1', contextChip: null },
            messages: [
              {
                ...assistantSample('greeting', { id: 'a1' }),
                feedback: stored,
              },
            ],
            quickReplies: [],
            nextBefore: null,
          })
        ),
        putFeedback: jest.fn(
          (_sessionId: string, messageId: string, body: FeedbackRequest) =>
            held<FeedbackResponse>({ messageId, ...body })
        ),
        deleteFeedback: jest.fn(() => held<void>(undefined)),
      });
      restore = setAssistantPort(port);
      const client = newClient();
      const { result } = renderHook(
        () => ({
          session: useAssistantSession('trip-1'),
          feedback: useMessageFeedback('s1'),
        }),
        { wrapper: wrapperWith(client) }
      );
      await waitFor(() => expect(result.current.session.isSuccess).toBe(true));

      // Act — 평가를 보내고(낙관), 응답 전에 재조회가 캐시를 덮은 뒤, 서버가 성공으로 답한다
      act(() => {
        result.current.feedback.mutate({ messageId: 'a1', request });
      });
      await waitFor(() =>
        expect(
          request ? port.putFeedback : port.deleteFeedback
        ).toHaveBeenCalledTimes(1)
      );
      await act(async () => {
        await result.current.session.refetch();
      });
      expect(port.openSession).toHaveBeenCalledTimes(2);
      await act(async () => {
        settle();
      });

      // Assert — 화면이 그리는 캐시가 서버 값이다
      await waitFor(() => expect(feedbackIn(client, 'a1')).toBe(saved));
    }
  );
});

// ── 이전 대화 더 보기 ─────────────────────────────────────────────────────────
// 메시지 캐시 모양 `{messages, nextBefore}` 는 그대로 두고 옛 페이지를 앞에 붙인다(useInfiniteQuery 안 씀).

const m = (id: string) => userMessage(id, id);
const idsOf = (messages: readonly { id: string }[]) =>
  messages.map((message) => message.id);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function cacheOf(client: QueryClient): MessagesPage | undefined {
  return client.getQueryData<MessagesPage>(assistantKeys.messages('s1'));
}

describe('prependMessages (이전 대화 더 보기)', () => {
  it('옛 쪽 전체가 기존 목록 앞에 온다(오래된 것 먼저)', () => {
    expect(idsOf(prependMessages([m('a'), m('b')], [m('c')]))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('같은 id 가 겹치면 기존 것을 남기고 옛 쪽을 버린다(낙관 갱신된 값이 옛 값으로 안 돌아간다)', () => {
    const existing = { ...m('a'), text: '기존' };
    const older = { ...m('a'), text: '옛' };

    const merged = prependMessages([older, m('b')], [existing, m('c')]);

    expect(idsOf(merged)).toEqual(['b', 'a', 'c']);
    expect(merged[1]).toBe(existing);
  });

  it('한쪽이 비어 있으면 다른 쪽 그대로', () => {
    expect(idsOf(prependMessages([], [m('a')]))).toEqual(['a']);
    expect(idsOf(prependMessages([m('a')], []))).toEqual(['a']);
  });

  it('PBT · 결과 id 는 유일하고, 끝은 기존 목록 그대로이며, 두 쪽의 합집합이다', () => {
    const idsArb = fc.uniqueArray(
      fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'),
      { maxLength: 6 }
    );
    fc.assert(
      fc.property(idsArb, idsArb, (olderIds, currentIds) => {
        const merged = idsOf(
          prependMessages(olderIds.map(m), currentIds.map(m))
        );

        expect(new Set(merged).size).toBe(merged.length);
        expect(merged.slice(merged.length - currentIds.length)).toEqual(
          currentIds
        );
        expect(new Set(merged)).toEqual(new Set([...olderIds, ...currentIds]));
      })
    );
  });
});

describe('세션 열기가 메시지 캐시에 커서를 심는다 (AC-1·AC-5)', () => {
  function openResponse(
    messages: ReturnType<typeof m>[],
    nextBefore: string | null
  ): OpenSessionResponse {
    return {
      session: { id: 's1', tripId: 'trip-1', contextChip: null },
      messages,
      quickReplies: [],
      nextBefore,
    };
  }

  it('응답의 nextBefore 를 그대로 보관한다(null 하드코딩 아님)', async () => {
    restore = setAssistantPort(
      stubPort({
        openSession: jest.fn(() =>
          Promise.resolve(openResponse([m('m3'), m('m4')], 'cur-30'))
        ),
      })
    );
    const client = newClient();

    const { result } = renderHook(() => useAssistantSession('trip-1'), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(cacheOf(client)?.nextBefore).toBe('cur-30');
  });

  // 선제 green — 현행도 null 을 심는다. 구서버(필드 부재)가 "더 없음"으로 읽히는 계약을 잠근다.
  it('필드가 없는 구서버 응답은 null(더 없음)로 보관한다', async () => {
    const legacy = {
      session: { id: 's1', tripId: 'trip-1', contextChip: null },
      messages: [m('m3')],
      quickReplies: [],
    } as unknown as OpenSessionResponse;
    restore = setAssistantPort(
      stubPort({ openSession: jest.fn(() => Promise.resolve(legacy)) })
    );
    const client = newClient();

    const { result } = renderHook(() => useAssistantSession('trip-1'), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(cacheOf(client)?.nextBefore).toBeNull();
  });

  it('재조회는 붙여 둔 옛 메시지를 지우지 않고 새 id 만 뒤에 더하며, 보관 중인 커서와 기존 메시지 값을 지킨다', async () => {
    // Arrange — 첫 열기는 [m3,m4]+'c1', 재조회는 [m3,m4,m5]+'c1'
    const responses = [
      openResponse([m('m3'), m('m4')], 'c1'),
      openResponse([m('m3'), m('m4'), m('m5')], 'c1'),
    ];
    let call = 0;
    const port = stubPort({
      openSession: jest.fn(() => Promise.resolve(responses[call++])),
      getMessages: jest.fn(() =>
        Promise.resolve({ messages: [m('m1'), m('m2')], nextBefore: null })
      ),
    });
    restore = setAssistantPort(port);
    const client = newClient();
    const { result } = renderHook(
      () => ({
        session: useAssistantSession('trip-1'),
        older: useLoadOlderMessages('s1'),
      }),
      { wrapper: wrapperWith(client) }
    );
    await waitFor(() => expect(result.current.session.isSuccess).toBe(true));
    await act(async () => {
      result.current.older.loadOlder();
    });
    await waitFor(() => expect(cacheOf(client)?.nextBefore).toBeNull());
    // 평가가 캐시에서만 바뀐 상태(재조회 응답엔 아직 없음)
    client.setQueryData<MessagesPage>(assistantKeys.messages('s1'), (page) => ({
      ...page,
      messages: (page?.messages ?? []).map((message) =>
        message.id === 'm4' ? { ...message, feedback: 'UP' as const } : message
      ),
    }));

    // Act — 탭 복귀 같은 세션 재조회
    await act(async () => {
      await result.current.session.refetch();
    });

    // Assert
    expect(port.openSession).toHaveBeenCalledTimes(2);
    expect(idsOf(cacheOf(client)?.messages ?? [])).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
    ]);
    expect(cacheOf(client)?.nextBefore).toBeNull();
    expect(
      cacheOf(client)?.messages.find((message) => message.id === 'm4')?.feedback
    ).toBe('UP');
  });
});

describe('useLoadOlderMessages (이전 대화 더 보기)', () => {
  const olderPage: MessagesPage = {
    messages: [m('m1'), m('m2')],
    nextBefore: 'c0',
  };

  function setup(
    getMessages: AssistantPort['getMessages'],
    cache: MessagesPage = { messages: [m('m3'), m('m4')], nextBefore: 'c1' }
  ) {
    const port = stubPort({ getMessages });
    restore = setAssistantPort(port);
    const client = newClient();
    client.setQueryData<MessagesPage>(assistantKeys.messages('s1'), cache);
    const hook = renderHook(() => useLoadOlderMessages('s1'), {
      wrapper: wrapperWith(client),
    });
    return { port, client, ...hook };
  }

  it('보관 중인 커서 그대로(limit 없이) 부르고, 받은 쪽을 앞에 붙이며 커서를 응답 값으로 바꾼다', async () => {
    // Arrange
    const getMessages = jest.fn(() => Promise.resolve(olderPage));
    const { client, result } = setup(getMessages);
    expect(result.current.hasMore).toBe(true);

    // Act
    await act(async () => {
      result.current.loadOlder();
    });

    // Assert
    await waitFor(() =>
      expect(idsOf(cacheOf(client)?.messages ?? [])).toEqual([
        'm1',
        'm2',
        'm3',
        'm4',
      ])
    );
    expect(getMessages).toHaveBeenCalledTimes(1);
    expect(getMessages.mock.calls[0]).toStrictEqual(['s1', { before: 'c1' }]);
    expect(cacheOf(client)?.nextBefore).toBe('c0');
    expect(result.current.hasMore).toBe(true);
    expect(result.current.status).toBe('idle');
  });

  it.each([null, undefined])(
    '응답 nextBefore 가 %s 면 캐시는 null, 더 볼 것이 없다',
    async (nextBefore) => {
      const { client, result } = setup(
        jest.fn(() => Promise.resolve({ messages: [m('m2')], nextBefore }))
      );

      await act(async () => {
        result.current.loadOlder();
      });

      await waitFor(() => expect(result.current.hasMore).toBe(false));
      expect(cacheOf(client)?.nextBefore).toBeNull();
    }
  );

  it.each([null, undefined])(
    '캐시의 nextBefore 가 %s 면 요청을 보내지 않는다',
    async (nextBefore) => {
      const getMessages = jest.fn(() => Promise.resolve(olderPage));
      const { result } = setup(getMessages, {
        messages: [m('m3')],
        nextBefore,
      });

      await act(async () => {
        result.current.loadOlder();
      });

      expect(result.current.hasMore).toBe(false);
      expect(getMessages).not.toHaveBeenCalled();
    }
  );

  it('세션이 아직 없으면(sessionId undefined) 요청을 보내지 않는다', async () => {
    const getMessages = jest.fn(() => Promise.resolve(olderPage));
    restore = setAssistantPort(stubPort({ getMessages }));
    const client = newClient();
    const { result } = renderHook(() => useLoadOlderMessages(undefined), {
      wrapper: wrapperWith(client),
    });

    await act(async () => {
      result.current.loadOlder();
    });

    expect(result.current.hasMore).toBe(false);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('금지 · 진행 중에 같은 틱으로 두 번 불러도 요청은 1회(로딩 상태), 끝나면 idle', async () => {
    const held = deferred<MessagesPage>();
    const getMessages = jest.fn(() => held.promise);
    const { result } = setup(getMessages);

    await act(async () => {
      result.current.loadOlder();
      result.current.loadOlder();
    });

    expect(getMessages).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.status).toBe('loading'));
    await act(async () => {
      held.resolve(olderPage);
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
  });

  it('실패하면 error 로 두고 캐시는 그대로, 다시 부르면 같은 커서로 재요청해 성공한다', async () => {
    // Arrange
    const getMessages = jest
      .fn()
      .mockRejectedValueOnce(new AssistantApiError('SERVER'))
      .mockResolvedValueOnce(olderPage);
    const { client, result } = setup(getMessages);

    // Act 1 — 실패
    await act(async () => {
      result.current.loadOlder();
    });

    // Assert 1 — 침묵하지 않고(error) 보이던 것은 그대로
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(idsOf(cacheOf(client)?.messages ?? [])).toEqual(['m3', 'm4']);
    expect(cacheOf(client)?.nextBefore).toBe('c1');
    expect(result.current.hasMore).toBe(true);

    // Act 2 — 다시 시도
    await act(async () => {
      result.current.loadOlder();
    });

    // Assert 2
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(getMessages.mock.calls[1]).toStrictEqual(['s1', { before: 'c1' }]);
    expect(idsOf(cacheOf(client)?.messages ?? [])).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
  });

  it('응답을 기다리는 사이 새 메시지가 캐시 뒤에 붙어도, 옛 쪽은 그 최신 캐시 앞에 붙는다(요청 시점 목록으로 덮지 않는다)', async () => {
    // Arrange — 응답을 붙잡아 둔다
    const held = deferred<MessagesPage>();
    const { client, result } = setup(jest.fn(() => held.promise));
    await act(async () => {
      result.current.loadOlder();
    });

    // Act — 그 사이 턴 응답이 도착해 뒤에 붙고, 이어서 옛 쪽 응답이 온다
    act(() => {
      client.setQueryData<MessagesPage>(
        assistantKeys.messages('s1'),
        (page) => ({
          ...page,
          messages: appendMessages(page?.messages ?? [], [m('m5')]),
        })
      );
    });
    await act(async () => {
      held.resolve(olderPage);
    });

    // Assert
    await waitFor(() =>
      expect(idsOf(cacheOf(client)?.messages ?? [])).toEqual([
        'm1',
        'm2',
        'm3',
        'm4',
        'm5',
      ])
    );
    expect(cacheOf(client)?.nextBefore).toBe('c0');
  });
});

// 선제 green — 현행 코드가 이미 지키는 것을 옛 쪽 붙이기 도입 뒤에도 잠근다.
describe('커서는 다른 캐시 갱신이 건드리지 않는다 (AC-7·AC-8 회귀)', () => {
  const proposalMessage = assistantSample('proposal', { id: 'p-msg' });
  const proposalId = proposalMessage.proposal?.id ?? '';

  function seeded(port: Partial<AssistantPort>) {
    restore = setAssistantPort(stubPort(port));
    const client = newClient();
    client.setQueryData<MessagesPage>(assistantKeys.messages('s1'), {
      messages: [m('a'), proposalMessage],
      nextBefore: 'c9',
    });
    return client;
  }

  it('턴 응답을 뒤에 붙여도 nextBefore 는 그대로', async () => {
    const client = seeded({
      sendTurn: jest.fn(() =>
        Promise.resolve({ messages: [m('n1')], quickReplies: [] })
      ),
    });
    const { result } = renderHook(() => useSendTurn('s1'), {
      wrapper: wrapperWith(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        request: {
          clientTurnId: 'c1',
          input: { type: 'TEXT', text: 'x' },
          screen: { surface: 'LIVE' },
        },
      });
    });

    expect(idsOf(cacheOf(client)?.messages ?? [])).toContain('n1');
    expect(cacheOf(client)?.nextBefore).toBe('c9');
  });

  it('제안 상태 패치(취소)도 nextBefore 는 그대로', async () => {
    const client = seeded({
      dismissProposal: jest.fn(() =>
        Promise.resolve({ proposal: { id: proposalId, status: 'DISMISSED' } })
      ),
    });
    const { result } = renderHook(() => useDismissProposal('s1'), {
      wrapper: wrapperWith(client),
    });

    await act(async () => {
      await result.current.mutateAsync(proposalId);
    });

    expect(
      cacheOf(client)?.messages.find((message) => message.id === 'p-msg')
        ?.proposal?.status
    ).toBe('DISMISSED');
    expect(cacheOf(client)?.nextBefore).toBe('c9');
  });

  it('평가 낙관 패치도 nextBefore 는 그대로', async () => {
    const client = seeded({
      putFeedback: jest.fn(() =>
        Promise.resolve({
          messageId: 'p-msg',
          rating: 'UP' as const,
          reason: null,
          comment: null,
        })
      ),
    });
    const { result } = renderHook(() => useMessageFeedback('s1'), {
      wrapper: wrapperWith(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        messageId: 'p-msg',
        request: { rating: 'UP', reason: null, comment: null },
      });
    });

    expect(
      cacheOf(client)?.messages.find((message) => message.id === 'p-msg')
        ?.feedback
    ).toBe('UP');
    expect(cacheOf(client)?.nextBefore).toBe('c9');
  });

  it('이력 지우기로 메시지 캐시를 치우면 커서도 함께 사라진다', async () => {
    const client = seeded({ clearSession: jest.fn(() => Promise.resolve()) });
    const { result } = renderHook(() => useClearSession('trip-1'), {
      wrapper: wrapperWith(client),
    });

    await act(async () => {
      await result.current.mutateAsync('s1');
    });

    expect(cacheOf(client)).toBeUndefined();
  });
});

// ── 세션 경계 가드 뮤테이션 심판 (후속 20261022) ───────────────────────────────
// 구현(W1·N1)이 먼저 들어가 있어 red 단계가 없다 — 가드를 지우면 해당 케이스만 red 가 되는지를 뮤테이션으로 실측했다.
describe('useLoadOlderMessages · 세션 경계 가드 (W1·N1)', () => {
  const olderPage: MessagesPage = { messages: [m('o1')], nextBefore: null };
  const flush = () =>
    act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });

  function setupTwoSessions() {
    const held = {
      s1: deferred<MessagesPage>(),
      s2: deferred<MessagesPage>(),
    };
    const getMessages = jest.fn((sessionId: string) =>
      sessionId === 's1' ? held.s1.promise : held.s2.promise
    );
    restore = setAssistantPort(stubPort({ getMessages }));
    const client = newClient();
    for (const id of ['s1', 's2']) {
      client.setQueryData<MessagesPage>(assistantKeys.messages(id), {
        messages: [m(`${id}-a`)],
        nextBefore: 'c1',
      });
    }
    const hook = renderHook(
      ({ id }: { id: string }) => useLoadOlderMessages(id),
      { initialProps: { id: 's1' }, wrapper: wrapperWith(client) }
    );
    const pageOf = (id: string) =>
      client.getQueryData<MessagesPage>(assistantKeys.messages(id));
    const callsFor = (id: string) =>
      getMessages.mock.calls.filter(([sessionId]) => sessionId === id).length;
    return { client, held, pageOf, callsFor, ...hook };
  }

  /** s1 요청이 떠 있는 채로 s2 로 옮기고, s2 요청도 떠 있게 한다. */
  async function s1InFlightThenS2Loading(
    ctx: ReturnType<typeof setupTwoSessions>
  ) {
    await act(async () => {
      ctx.result.current.loadOlder();
    });
    ctx.rerender({ id: 's2' });
    await act(async () => {
      ctx.result.current.loadOlder();
    });
    await waitFor(() => expect(ctx.result.current.status).toBe('loading'));
  }

  it('W1 · 요청이 떠 있는 동안 캐시가 지워지면(이력 지우기) 늦은 응답이 캐시를 새로 심지 않는다', async () => {
    // Arrange
    const ctx = setupTwoSessions();
    await act(async () => {
      ctx.result.current.loadOlder();
    });

    // Act — useClearSession 과 같은 removeQueries, 그 뒤에 응답이 도착
    act(() => {
      ctx.client.removeQueries({ queryKey: assistantKeys.messages('s1') });
    });
    await act(async () => {
      ctx.held.s1.resolve(olderPage);
    });
    await waitFor(() => expect(ctx.result.current.status).toBe('idle'));

    // Assert
    expect(ctx.pageOf('s1')).toBeUndefined();
  });

  it.each(['error', 'loading'] as const)(
    'N1 · 세션이 바뀌면 %s 였던 상태가 idle 로 돌아오고 새 세션에서 요청을 보낼 수 있다',
    async (before) => {
      // Arrange — s1 을 error 또는 loading 으로 만든다
      const ctx = setupTwoSessions();
      await act(async () => {
        ctx.result.current.loadOlder();
      });
      if (before === 'error') {
        await act(async () => {
          ctx.held.s1.reject(new AssistantApiError('SERVER'));
        });
      }
      await waitFor(() => expect(ctx.result.current.status).toBe(before));

      // Act
      ctx.rerender({ id: 's2' });

      // Assert
      await waitFor(() => expect(ctx.result.current.status).toBe('idle'));
      await act(async () => {
        ctx.result.current.loadOlder();
      });
      expect(ctx.callsFor('s2')).toBe(1);
    }
  );

  it('N1 · 이전 세션의 늦은 성공은 새 세션의 loading 을 건드리지 않고, 새 세션 캐시도 안 바꾼다', async () => {
    // Arrange
    const ctx = setupTwoSessions();
    await s1InFlightThenS2Loading(ctx);
    const s2Before = ctx.pageOf('s2');

    // Act
    await act(async () => {
      ctx.held.s1.resolve(olderPage);
    });
    await flush();

    // Assert — 옛 쪽은 요청 당시 세션(s1)에 붙고, s2 는 그대로
    expect(ctx.result.current.status).toBe('loading');
    expect(idsOf(ctx.pageOf('s1')?.messages ?? [])).toEqual(['o1', 's1-a']);
    expect(ctx.pageOf('s2')).toBe(s2Before);
  });

  it('N1 · 이전 세션의 늦은 실패는 새 세션을 error 로 바꾸지 않는다', async () => {
    // Arrange
    const ctx = setupTwoSessions();
    await s1InFlightThenS2Loading(ctx);

    // Act
    await act(async () => {
      ctx.held.s1.reject(new AssistantApiError('SERVER'));
    });
    await flush();

    // Assert
    expect(ctx.result.current.status).toBe('loading');
  });

  it('N1 · 이전 세션 요청이 끝나도 새 세션의 진행 중 표식은 풀리지 않아, 같은 틱 재호출은 요청 1회로 막힌다', async () => {
    // Arrange
    const ctx = setupTwoSessions();
    await s1InFlightThenS2Loading(ctx);
    expect(ctx.callsFor('s2')).toBe(1);

    // Act — s1 이 끝난 뒤 s2 에서 두 번 더 부른다
    await act(async () => {
      ctx.held.s1.resolve(olderPage);
    });
    await flush();
    await act(async () => {
      ctx.result.current.loadOlder();
      ctx.result.current.loadOlder();
    });

    // Assert — 처음 1회뿐
    expect(ctx.callsFor('s2')).toBe(1);
  });
});

// ── 세션 재조회 합치기 W2 (후속 20261022) ─────────────────────────────────────
// 겹치는 id 는 proposal 칸만 서버값, 나머지 칸은 캐시(평가 낙관 갱신 보호 — 기존 H10 이 그대로 green 이어야 한다).
describe('세션 재조회 합치기 (W2)', () => {
  const cachedProposal = assistantSample('proposal', { id: 'p' });
  const serverProposal: Proposal = {
    ...(cachedProposal.proposal as Proposal),
    status: 'APPLIED',
    violations: ['서버 판정'],
    applyHint: 'AUTO_APPLY',
  };
  const cachedP: AssistantMessage = {
    ...cachedProposal,
    text: '캐시 문장',
    feedback: 'UP',
  };

  async function reopenOver(
    cache: MessagesPage,
    incoming: AssistantMessage[],
    nextBefore: string | null = 'c-server'
  ) {
    restore = setAssistantPort(
      stubPort({
        openSession: jest.fn(() =>
          Promise.resolve({
            session: { id: 's1', tripId: 'trip-1', contextChip: null },
            messages: incoming,
            quickReplies: [],
            nextBefore,
          })
        ),
      })
    );
    const client = newClient();
    client.setQueryData<MessagesPage>(assistantKeys.messages('s1'), cache);
    const { result } = renderHook(() => useAssistantSession('trip-1'), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const find = (id: string) =>
      cacheOf(client)?.messages.find((message) => message.id === id);
    return Object.assign(find, { page: () => cacheOf(client) });
  }

  it('겹치는 id 의 proposal 은 응답 값으로 통째 바뀐다(status·violations·applyHint)', async () => {
    const find = await reopenOver({ messages: [cachedP], nextBefore: 'c0' }, [
      { ...cachedP, proposal: serverProposal },
    ]);

    expect(find('p')?.proposal).toEqual(serverProposal);
  });

  it('proposal 말고 다른 칸(text·평가)은 캐시 값을 지킨다', async () => {
    const find = await reopenOver({ messages: [cachedP], nextBefore: 'c0' }, [
      {
        ...cachedP,
        text: '서버 문장',
        feedback: null,
        proposal: serverProposal,
      },
    ]);

    expect(find('p')?.text).toBe('캐시 문장');
    expect(find('p')?.feedback).toBe('UP');
  });

  it.each([undefined, null])(
    '응답의 proposal 이 %s 이면 캐시 proposal 을 지킨다',
    async (empty) => {
      const find = await reopenOver({ messages: [cachedP], nextBefore: 'c0' }, [
        { ...cachedP, proposal: empty },
      ]);

      expect(find('p')?.proposal).toEqual(cachedP.proposal);
    }
  );

  it('새 id 는 뒤에 붙고 겹친 id 는 캐시 자리에 남으며, 보관 중인 커서는 응답이 바꾸지 않는다', async () => {
    const cache: MessagesPage = {
      messages: [m('a'), cachedP, m('b')],
      nextBefore: 'c0',
    };

    const find = await reopenOver(cache, [
      { ...cachedP, proposal: serverProposal },
      m('c'),
    ]);

    expect(idsOf(find.page()?.messages ?? [])).toEqual(['a', 'p', 'b', 'c']);
    expect(find.page()?.nextBefore).toBe('c0');
  });

  it('응답 30건 밖의 옛 메시지는 바뀌지 않는다(제안 상태도 그대로 — 알려진 한계)', async () => {
    const older: AssistantMessage = {
      ...assistantSample('proposal', { id: 'old' }),
    };
    const find = await reopenOver(
      { messages: [older, cachedP], nextBefore: 'c0' },
      [{ ...cachedP, proposal: serverProposal }]
    );

    expect(find('old')).toBe(older);
    expect(find('old')?.proposal?.status).toBe('PROPOSED');
  });

  // 후속 20261022 (5-b W-2) — [적용] 성공으로 캐시가 APPLIED 가 된 뒤, 적용보다 **먼저 떠난** 재조회의 옛 스냅샷(PROPOSED)이
  // 늦게 도착하면 되돌아가 [적용] 버튼이 다시 보였다. 한 번 결정된 상태(PROPOSED 가 아닌 것)는 PROPOSED 로 되돌리지 않는다.
  it.each(['APPLIED', 'DISMISSED', 'EXPIRED', 'STALE', 'FAILED'] as const)(
    '캐시가 %s 인데 응답이 PROPOSED(옛 스냅샷)면 캐시 상태를 지킨다',
    async (decided) => {
      const decidedP: AssistantMessage = {
        ...cachedP,
        proposal: { ...(cachedP.proposal as Proposal), status: decided },
      };
      const find = await reopenOver(
        { messages: [decidedP], nextBefore: 'c0' },
        [
          {
            ...cachedP,
            proposal: { ...(cachedP.proposal as Proposal), status: 'PROPOSED' },
          },
        ]
      );

      expect(find('p')?.proposal?.status).toBe(decided);
    }
  );

  // 5-b(경량 W-2 가드) 심판 사각 두 건 — 가드가 과잉이면 여기서 빨개진다.
  it('캐시도 응답도 PROPOSED 인데 내용(violations)만 바뀌면 응답을 따른다', async () => {
    const find = await reopenOver({ messages: [cachedP], nextBefore: 'c0' }, [
      {
        ...cachedP,
        proposal: {
          ...(cachedP.proposal as Proposal),
          violations: ['서버가 새로 본 위반'],
        },
      },
    ]);

    expect(find('p')?.proposal?.status).toBe('PROPOSED');
    expect(find('p')?.proposal?.violations).toEqual(['서버가 새로 본 위반']);
  });

  it('캐시 메시지에 제안이 없고 응답에 새 제안(PROPOSED)이 붙으면 그대로 들어온다', async () => {
    const plain: AssistantMessage = { ...cachedP, proposal: undefined };
    const find = await reopenOver({ messages: [plain], nextBefore: 'c0' }, [
      {
        ...cachedP,
        proposal: { ...(cachedP.proposal as Proposal), status: 'PROPOSED' },
      },
    ]);

    expect(find('p')?.proposal?.status).toBe('PROPOSED');
  });

  it('캐시가 결정된 상태라도 응답이 다른 결정 상태면 응답을 따른다(APPLIED → EXPIRED)', async () => {
    const appliedP: AssistantMessage = {
      ...cachedP,
      proposal: { ...(cachedP.proposal as Proposal), status: 'APPLIED' },
    };
    const find = await reopenOver({ messages: [appliedP], nextBefore: 'c0' }, [
      {
        ...cachedP,
        proposal: { ...(cachedP.proposal as Proposal), status: 'EXPIRED' },
      },
    ]);

    expect(find('p')?.proposal?.status).toBe('EXPIRED');
  });
});
