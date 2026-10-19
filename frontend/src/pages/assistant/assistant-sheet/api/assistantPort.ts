import type {
  ApplyProposalResponse,
  AssistantSessionSummary,
  DismissProposalResponse,
  FeedbackRequest,
  FeedbackResponse,
  MessagesPage,
  OpenSessionResponse,
  SendTurnRequest,
  SendTurnResponse,
} from './assistantContract';

/**
 * 도우미 서버 경계(TRIP-1319) — 화면·훅은 이 인터페이스만 안다. 구현은 실 서버 `HttpAssistantAdapter`
 * (TRIP-1410)와 프리뷰·테스트용 `FakeAssistantAdapter` 둘이고, 고르는 곳은 `assistantClient.ts` 한 곳이다.
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
  /**
   * 답 평가 남기기·바꾸기(US-ASSIST-09). 턴이 아니다 — 턴 상한에 세지 않고 AI 를 부르지 않는다. 실패는 따로 가르지
   * 않는다: 남의·만료·없는 메시지(404)와 평가 대상 아님(400)도 `SERVER` 로 접힌다(화면은 되돌리고 안내만 한다).
   */
  putFeedback(
    sessionId: string,
    messageId: string,
    req: FeedbackRequest
  ): Promise<FeedbackResponse>;
  /** 답 평가 취소 — 남긴 평가가 없어도 성공(204, 멱등). */
  deleteFeedback(sessionId: string, messageId: string): Promise<void>;
}

export type AssistantErrorCode =
  /** 401 — 미인증. 세션 열기에서 나면 시트를 닫는다(frontend-components §1). */
  | 'UNAUTHORIZED'
  /** 429 — `retryAfterSeconds` 동안 보내기 비활성(BR-U8-24). */
  | 'RATE_LIMITED'
  /**
   * 429 + `error.code=TURN_IN_PROGRESS` — RATE_LIMITED 와 **반대**다. 그 턴은 이미 기록돼 처리 중이므로
   * 말풍선을 거두지 말고 **같은 clientTurnId 로** `retryAfterSeconds` 뒤 다시 보낸다(새 id 면 같은 말이 두 번 기록·해석된다).
   */
  | 'TURN_IN_PROGRESS'
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
