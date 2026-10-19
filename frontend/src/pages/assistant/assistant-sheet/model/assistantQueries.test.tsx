import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { setAssistantPort } from '../api/assistantClient';
import type { MessagesPage } from '../api/assistantContract';
import { AssistantApiError, type AssistantPort } from '../api/assistantPort';
import {
  assistantSample,
  sampleTranscript,
  userMessage,
} from '../api/assistantSamples';
import {
  appendMessages,
  assistantKeys,
  useAssistantSession,
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
});
