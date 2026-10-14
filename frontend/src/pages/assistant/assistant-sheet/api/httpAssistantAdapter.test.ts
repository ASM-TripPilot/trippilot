import type { AxiosRequestConfig } from 'axios';
import { AxiosError, AxiosHeaders, CanceledError } from 'axios';

import type { SendTurnRequest } from './assistantContract';
import { AssistantApiError } from './assistantPort';
import { HttpAssistantAdapter, toAssistantError } from './httpAssistantAdapter';

/**
 * 실 어댑터(TRIP-1410) — 재는 것 둘:
 * - 각 포트 메서드가 BE `/api/v1/assistant/**` 의 어느 경로·메서드로 나가는가(바디·쿼리·signal 포함)
 * - 원시 axios 실패가 화면이 분기하는 `AssistantApiError.code` 로 접히는가
 */

function httpError(
  status: number,
  data: unknown = null,
  headers: Record<string, string> = {}
): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data,
    headers: new AxiosHeaders(headers),
    config: { headers: new AxiosHeaders() },
  };
  return error;
}

function recorder(result: unknown = {}) {
  const calls: AxiosRequestConfig[] = [];
  const request = <T>(config: AxiosRequestConfig): Promise<T> => {
    calls.push(config);
    return Promise.resolve(result as T);
  };
  return { calls, adapter: new HttpAssistantAdapter(request) };
}

describe('경로 — 포트 메서드 ↔ BE 엔드포인트', () => {
  it('각 메서드가 정해진 메서드·경로·바디로 나간다', async () => {
    // Arrange
    const { calls, adapter } = recorder();
    const signal = new AbortController().signal;
    const turn: SendTurnRequest = {
      clientTurnId: 't1',
      input: { type: 'TEXT', text: '날씨 알려줘' },
      screen: { surface: 'HOME' },
    };

    // Act
    await adapter.openSession({ tripId: 'trip-1' });
    await adapter.listSessions();
    await adapter.getMessages('s1', { before: 'm9', limit: 20 });
    await adapter.sendTurn('s1', turn, { signal });
    await adapter.applyProposal('p1');
    await adapter.dismissProposal('p1');
    await adapter.clearSession('s1');

    // Assert
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/assistant/sessions',
        data: { tripId: 'trip-1' },
      },
      { method: 'GET', url: '/assistant/sessions' },
      {
        method: 'GET',
        url: '/assistant/sessions/s1/messages',
        params: { before: 'm9', limit: 20 },
      },
      {
        method: 'POST',
        url: '/assistant/sessions/s1/turns',
        data: turn,
        signal,
      },
      { method: 'POST', url: '/assistant/proposals/p1/apply' },
      { method: 'POST', url: '/assistant/proposals/p1/dismiss' },
      { method: 'DELETE', url: '/assistant/sessions/s1' },
    ]);
  });

  it('성공 바디는 변환 없이 그대로 돌려준다', async () => {
    const body = { sessionId: 's1', messages: [], nextBefore: null };
    const { adapter } = recorder(body);
    await expect(adapter.openSession({ tripId: null })).resolves.toBe(body);
  });

  it('실패는 원시 axios 에러가 아니라 AssistantApiError 로 던진다', async () => {
    const adapter = new HttpAssistantAdapter(() =>
      Promise.reject(httpError(500))
    );
    const error = await adapter.listSessions().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AssistantApiError);
    expect((error as AssistantApiError).code).toBe('SERVER');
  });
});

describe('실패 정규화 — toAssistantError', () => {
  it.each([
    ['401', httpError(401), 'UNAUTHORIZED'],
    ['409 STALE', httpError(409, { error: { code: 'STALE' } }), 'STALE'],
    ['409 EXPIRED', httpError(409, { error: { code: 'EXPIRED' } }), 'EXPIRED'],
    [
      '409 NOT_APPLICABLE',
      httpError(409, { error: { code: 'NOT_APPLICABLE' } }),
      'NOT_APPLICABLE',
    ],
    // 모르는 409 를 SERVER 로 두면 화면이 [다시 시도]로 같은 409 를 되풀이한다
    [
      '409 모르는 코드',
      httpError(409, { error: { code: 'X' } }),
      'NOT_APPLICABLE',
    ],
    ['409 바디 없음', httpError(409), 'NOT_APPLICABLE'],
    ['500', httpError(500), 'SERVER'],
    ['403', httpError(403), 'SERVER'],
    ['네트워크(응답 없음)', new AxiosError('Network Error'), 'SERVER'],
    ['axios 아닌 오류', new TypeError('boom'), 'SERVER'],
    ['대기 취소', new CanceledError(), 'ABORTED'],
  ])('%s → %s', (_label, raw, code) => {
    expect(toAssistantError(raw).code).toBe(code);
  });

  it('429 TURN_IN_PROGRESS 는 RATE_LIMITED 가 아니다 — 같은 턴 id 로 다시 보내는 SERVER 다', () => {
    const inProgress = httpError(
      429,
      { error: { code: 'TURN_IN_PROGRESS' } },
      {
        'Retry-After': '13',
      }
    );
    expect(toAssistantError(inProgress).code).toBe('SERVER');
    // 분당 한도(코드 RATE_LIMITED)는 그대로 막는다
    expect(
      toAssistantError(httpError(429, { error: { code: 'RATE_LIMITED' } })).code
    ).toBe('RATE_LIMITED');
  });

  it('429 는 Retry-After 초를 싣는다 — 헤더가 없으면 null', () => {
    const limited = toAssistantError(
      httpError(429, null, { 'Retry-After': '12' })
    );
    expect(limited.code).toBe('RATE_LIMITED');
    expect(limited.retryAfterSeconds).toBe(12);

    expect(toAssistantError(httpError(429)).retryAfterSeconds).toBeNull();
  });
});
