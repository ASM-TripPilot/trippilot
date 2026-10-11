import type {
  ApplyProposalResponse,
  AssistantSessionSummary,
  DismissProposalResponse,
  MessagesPage,
  OpenSessionResponse,
  SendTurnRequest,
  SendTurnResponse,
} from './assistantContract';

/**
 * 도우미 서버 경계(TRIP-1319) — 화면·훅은 이 인터페이스만 안다. 구현은 지금 `FakeAssistantAdapter`
 * 하나이고, BE assistant API 가 열리면 http 어댑터를 만들어 `assistantClient.ts` 한 곳에서 바꾼다.
 *
 * 어댑터는 실패를 전부 `AssistantApiError` 로 정규화해 던진다 — 화면은 `code` 로만 분기하고
 * 원시 axios 에러를 보지 않는다(README §API 계층).
 */
export interface AssistantPort {
  openSession(req: { tripId: string | null }): Promise<OpenSessionResponse>;
  listSessions(): Promise<AssistantSessionSummary[]>;
  getMessages(
    sessionId: string,
    opts?: { before?: string; limit?: number }
  ): Promise<MessagesPage>;
  sendTurn(
    sessionId: string,
    req: SendTurnRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SendTurnResponse>;
  applyProposal(proposalId: string): Promise<ApplyProposalResponse>;
  dismissProposal(proposalId: string): Promise<DismissProposalResponse>;
  clearSession(sessionId: string): Promise<void>;
}

export type AssistantErrorCode =
  /** 401 — 미인증. 세션 열기에서 나면 시트를 닫는다(frontend-components §1). */
  | 'UNAUTHORIZED'
  /** 429 — `retryAfterSeconds` 동안 보내기 비활성(BR-U8-24). */
  | 'RATE_LIMITED'
  /** 409 — 제안 기준 지문 불일치(BR-U8-32). */
  | 'STALE'
  | 'EXPIRED'
  | 'NOT_APPLICABLE'
  /** 클라 측 대기 취소(AbortController, BR-U8-44). */
  | 'ABORTED'
  /** 5xx·네트워크 — 대화 저장 실패 포함(BR-U8-21 임시 보관). */
  | 'SERVER';

export class AssistantApiError extends Error {
  readonly code: AssistantErrorCode;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: AssistantErrorCode,
    options: { retryAfterSeconds?: number | null; message?: string } = {}
  ) {
    super(options.message ?? code);
    this.name = 'AssistantApiError';
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function isAssistantApiError(
  error: unknown
): error is AssistantApiError {
  return error instanceof AssistantApiError;
}
