import type { AxiosError, AxiosRequestConfig } from 'axios';
import { isAxiosError, isCancel } from 'axios';

import { retryAfterSeconds } from '@/shared/api';
import { customInstance } from '@/shared/api/index.client';

import type {
  ApplyProposalResponse,
  AssistantSessionSummary,
  DismissProposalResponse,
  MessagesPage,
  OpenSessionResponse,
  SendTurnRequest,
  SendTurnResponse,
} from './assistantContract';
import type { AssistantErrorCode, AssistantPort } from './assistantPort';
import { AssistantApiError } from './assistantPort';

type Request = <T>(config: AxiosRequestConfig) => Promise<T>;

/** 409 바디의 `error.code` 중 화면이 따로 그리는 것(BR-U8-32) — 백엔드 `ErrorCode` 와 같은 이름. */
const CONFLICT_CODES: ReadonlySet<AssistantErrorCode> =
  new Set<AssistantErrorCode>(['STALE', 'EXPIRED', 'NOT_APPLICABLE']);

/** 오류 바디 `{error:{code}}` 의 코드(백엔드 `ErrorCode`) — 없거나 문자열이 아니면 null. */
function errorCode(error: AxiosError): string | null {
  const code = (error.response?.data as { error?: { code?: unknown } } | null)
    ?.error?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * 원시 axios 실패 → `AssistantApiError`. 화면은 `code` 로만 분기한다(README §API 계층).
 * 모르는 409 는 `NOT_APPLICABLE` 로 둔다 — 제안을 더 누를 수 없다는 뜻이 가장 가깝고, `SERVER` 로 두면
 * 화면이 [다시 시도]를 보여 같은 409 를 되풀이한다.
 */
export function toAssistantError(error: unknown): AssistantApiError {
  if (
    isCancel(error) ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return new AssistantApiError('ABORTED');
  }
  if (!isAxiosError(error) || error.response === undefined) {
    return new AssistantApiError('SERVER', { message: '네트워크 오류' });
  }
  const status = error.response.status;
  if (status === 401) return new AssistantApiError('UNAUTHORIZED');
  if (status === 429) {
    // `TURN_IN_PROGRESS` 는 "기록돼 처리 중 — **같은 턴 id 로** Retry-After 뒤 다시"다. RATE_LIMITED 로 접으면 화면이
    // 말풍선을 거두고 새 id 로 다시 보내 같은 말이 두 번 기록·해석된다 → 별도 코드로 가른다.
    if (errorCode(error) === 'TURN_IN_PROGRESS') {
      return new AssistantApiError('TURN_IN_PROGRESS', {
        retryAfterSeconds: retryAfterSeconds(error),
      });
    }
    return new AssistantApiError('RATE_LIMITED', {
      retryAfterSeconds: retryAfterSeconds(error),
    });
  }
  if (status === 409) {
    const code = errorCode(error);
    return new AssistantApiError(
      code !== null && CONFLICT_CODES.has(code as AssistantErrorCode)
        ? (code as AssistantErrorCode)
        : 'NOT_APPLICABLE'
    );
  }
  return new AssistantApiError('SERVER', { message: `HTTP ${status}` });
}

/**
 * 도우미 서버 실 어댑터(TRIP-1410) — BE `/api/v1/assistant/**`(U8 FD §6). 인증·토큰 갱신은 공용
 * `customInstance`(orval mutator)를 그대로 탄다. 응답 본문은 BE 가 FE 계약(`assistantContract.ts`)
 * 모양 그대로 낸다 — 변환은 하지 않는다.
 */
export class HttpAssistantAdapter implements AssistantPort {
  constructor(private readonly request: Request = customInstance) {}

  private async call<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      return await this.request<T>(config);
    } catch (error) {
      throw toAssistantError(error);
    }
  }

  openSession(req: { tripId: string | null }): Promise<OpenSessionResponse> {
    return this.call({ method: 'POST', url: '/assistant/sessions', data: req });
  }

  listSessions(): Promise<AssistantSessionSummary[]> {
    return this.call({ method: 'GET', url: '/assistant/sessions' });
  }

  getMessages(
    sessionId: string,
    opts: { before?: string; limit?: number } = {}
  ): Promise<MessagesPage> {
    return this.call({
      method: 'GET',
      url: `/assistant/sessions/${sessionId}/messages`,
      params: opts,
    });
  }

  sendTurn(
    sessionId: string,
    req: SendTurnRequest,
    opts: { signal?: AbortSignal } = {}
  ): Promise<SendTurnResponse> {
    return this.call({
      method: 'POST',
      url: `/assistant/sessions/${sessionId}/turns`,
      data: req,
      signal: opts.signal,
    });
  }

  applyProposal(proposalId: string): Promise<ApplyProposalResponse> {
    return this.call({
      method: 'POST',
      url: `/assistant/proposals/${proposalId}/apply`,
    });
  }

  dismissProposal(proposalId: string): Promise<DismissProposalResponse> {
    return this.call({
      method: 'POST',
      url: `/assistant/proposals/${proposalId}/dismiss`,
    });
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.call({
      method: 'DELETE',
      url: `/assistant/sessions/${sessionId}`,
    });
  }
}
