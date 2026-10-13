import type {
  AssistantMessage,
  AssistantSessionSummary,
  OpenSessionResponse,
  ProposalStatus,
  QuickReply,
  SendTurnRequest,
  SendTurnResponse,
} from './assistantContract';
import { AssistantApiError, type AssistantPort } from './assistantPort';
import {
  assistantSample,
  sampleActionLogs,
  sampleSession,
  startQuickReplies,
  userMessage,
  type AssistantScenario,
} from './assistantSamples';

/**
 * 가짜 도우미 서버(TRIP-1319) — BE assistant 모듈·ai `/interpret` 가 없는 동안 앱·프리뷰·테스트가 쓴다.
 *
 * 흉내 내는 서버 규칙(business-logic-model §2·§2.1):
 * - 세션은 (여행 1개) 또는 일반 1개 — 같은 tripId 로 다시 열면 같은 세션·직전 대화(BR-U8-17).
 * - 턴 멱등: 같은 `(sessionId, clientTurnId)` 는 처음 응답을 그대로 돌려준다(INV-U8-05).
 * - ACTION 턴은 서버가 발급한 quick reply id 만 받는다(위조 차단 — 모르는 id 는 SERVER 오류).
 * - 제안 적용은 PROPOSED 에서만, 위반 있는 제안은 NOT_APPLICABLE, 한 번 적용된 제안은 다시 안 된다(INV-U8-08).
 * - 실패 응답부터 흉내 낸다(anti-patterns 「목을 성공 응답만으로 채우지 말 것」): 열기 실패·401·429·409·저장 실패.
 *
 * 발화 라우팅은 키워드 표(`routeUtterance`)다 — 진짜 해석은 ai 가 하므로 여기 정확도는 의미가 없고,
 * 시트의 각 상태에 사람이 손으로 닿게 하는 것이 목적이다.
 */

export interface FakeAssistantOptions {
  open?: 'OK' | 'FAIL' | 'UNAUTHORIZED';
  apply?: 'OK' | 'STALE' | 'EXPIRED' | 'NOT_APPLICABLE';
  /** 다음 턴들을 저장 실패(5xx)로 만든다 — 임시 보관·다시 보내기(BR-U8-21). */
  turn?: 'OK' | 'SERVER_ERROR';
  /** 값이 있으면 다음 턴이 429 + Retry-After(초). */
  rateLimitSeconds?: number | null;
  /** 응답 지연(ms). 0 이면 즉시. 앱 기본값은 체감용 약간의 지연. */
  latencyMs?: number;
  /** 세션을 열 때 이미 있는 대화(이어 열기 시연). */
  seedMessages?: AssistantMessage[];
  now?: () => string;
}

const KEYWORDS: readonly (readonly [RegExp, AssistantScenario])[] = [
  [/할 수 있는/, 'capabilities'],
  [/프롬프트|지침|막말|욕/, 'refusal'],
  [/예약|결제/, 'scope'],
  [/실패/, 'fallback-error'],
  [/검증/, 'fallback-solver'],
  [/숙소/, 'stay'],
  [/무리/, 'proposal-violation'],
  [/바꿔/, 'proposal'],
  [/추천|다른 곳|대신/, 'candidates'],
  [/검토/, 'review'],
  [/다음 장소|다음 일정/, 'next-slot'],
  [/날씨/, 'weather'],
];

/** 발화 → 시나리오. 여행 없는 세션에서 일정·동선 요청이면 b07 안내(BR-U8-05). */
export function routeUtterance(
  text: string,
  hasTrip: boolean
): AssistantScenario {
  const hit = KEYWORDS.find(([pattern]) => pattern.test(text))?.[1];
  const generalOk: (AssistantScenario | undefined)[] = [
    'refusal',
    'scope',
    'stay',
    'capabilities',
  ];
  if (!hasTrip && !generalOk.includes(hit)) {
    return 'no-context';
  }
  return hit ?? 'unknown';
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new AssistantApiError('ABORTED'));
  }
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new AssistantApiError('ABORTED'));
    });
  });
}

interface SessionState {
  tripId: string | null;
  messages: AssistantMessage[];
  turns: Map<string, SendTurnResponse>;
  lastUserText: string | null;
}

export class FakeAssistantAdapter implements AssistantPort {
  private readonly options: FakeAssistantOptions;
  private readonly sessions = new Map<string, SessionState>();
  private readonly issued = new Map<string, QuickReply>();
  private readonly proposals = new Map<
    string,
    { status: ProposalStatus; hasViolation: boolean; tripId: string | null }
  >();
  private seq = 0;
  /** 테스트 관측용 — 각 메서드 호출 수. */
  readonly calls = {
    openSession: 0,
    sendTurn: 0,
    applyProposal: 0,
    dismissProposal: 0,
    clearSession: 0,
  };

  constructor(options: FakeAssistantOptions = {}) {
    this.options = { ...options };
  }

  /** 시나리오를 바꾼다(테스트·프리뷰 — 진행 중 옵션 전환). */
  configure(patch: Partial<FakeAssistantOptions>): void {
    Object.assign(this.options, patch);
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private remember(replies: readonly QuickReply[] | null | undefined): void {
    replies?.forEach((item) => this.issued.set(item.id, item));
  }

  private track(message: AssistantMessage, tripId: string | null): void {
    this.remember(message.quickReplies);
    if (message.proposal) {
      this.proposals.set(message.proposal.id, {
        status: message.proposal.status,
        hasViolation: message.proposal.violations.length > 0,
        tripId,
      });
    }
  }

  /** 제안 상태를 바꾸면 저장된 메시지의 제안도 같이 바꾼다 — 다시 조회해도 서버 정본과 같게. */
  private setProposalStatus(proposalId: string, status: ProposalStatus): void {
    const proposal = this.proposals.get(proposalId);
    if (proposal) proposal.status = status;
    this.sessions.forEach((state) => {
      state.messages = state.messages.map((message) =>
        message.proposal?.id === proposalId
          ? { ...message, proposal: { ...message.proposal, status } }
          : message
      );
    });
  }

  private session(sessionId: string): SessionState {
    const state = this.sessions.get(sessionId);
    if (!state) throw new AssistantApiError('SERVER', { message: 'NOT_FOUND' });
    return state;
  }

  async openSession(req: {
    tripId: string | null;
  }): Promise<OpenSessionResponse> {
    this.calls.openSession += 1;
    await delay(this.options.latencyMs ?? 0);
    if (this.options.open === 'UNAUTHORIZED') {
      throw new AssistantApiError('UNAUTHORIZED');
    }
    if (this.options.open === 'FAIL') throw new AssistantApiError('SERVER');

    const session = sampleSession(req.tripId);
    let state = this.sessions.get(session.id);
    if (!state) {
      const seeded = this.options.seedMessages ?? [
        assistantSample(req.tripId ? 'greeting' : 'no-context', {
          id: this.nextId('m'),
          tripId: req.tripId,
          createdAt: this.now(),
        }),
      ];
      seeded.forEach((message) => this.track(message, req.tripId));
      state = {
        tripId: req.tripId,
        messages: [...seeded],
        turns: new Map(),
        lastUserText: null,
      };
      this.sessions.set(session.id, state);
    }
    const quickReplies = startQuickReplies(req.tripId !== null);
    this.remember(quickReplies);
    return { session, messages: [...state.messages], quickReplies };
  }

  async listSessions(): Promise<AssistantSessionSummary[]> {
    await delay(this.options.latencyMs ?? 0);
    return [...this.sessions.entries()].map(([id, state]) => ({
      id,
      tripId: state.tripId,
      tripTitle: state.tripId ? '부산 2박 3일' : null,
      lastTurnAt:
        state.messages[state.messages.length - 1]?.createdAt ?? this.now(),
    }));
  }

  async getMessages(sessionId: string) {
    await delay(this.options.latencyMs ?? 0);
    return {
      messages: [...this.session(sessionId).messages],
      nextBefore: null,
    };
  }

  async sendTurn(
    sessionId: string,
    req: SendTurnRequest,
    opts: { signal?: AbortSignal } = {}
  ): Promise<SendTurnResponse> {
    this.calls.sendTurn += 1;
    await delay(this.options.latencyMs ?? 0, opts.signal);
    const state = this.session(sessionId);

    const replay = state.turns.get(req.clientTurnId);
    if (replay) return replay;

    if (this.options.rateLimitSeconds) {
      const seconds = this.options.rateLimitSeconds;
      this.options.rateLimitSeconds = null;
      throw new AssistantApiError('RATE_LIMITED', {
        retryAfterSeconds: seconds,
      });
    }
    if (this.options.turn === 'SERVER_ERROR') {
      throw new AssistantApiError('SERVER');
    }

    let userText: string;
    let scenario: AssistantScenario;
    if (req.input.type === 'TEXT') {
      userText = req.input.text;
      scenario = routeUtterance(userText, state.tripId !== null);
      state.lastUserText = userText;
    } else {
      const picked = this.issued.get(req.input.quickReplyId);
      if (!picked)
        throw new AssistantApiError('SERVER', { message: 'BAD_QUICK_REPLY' });
      userText = picked.label;
      scenario = this.scenarioOfAction(picked, state);
    }

    const createdAt = this.now();
    const user = userMessage(this.nextId('u'), userText, createdAt);
    const assistant = assistantSample(scenario, {
      id: this.nextId('m'),
      tripId: state.tripId,
      createdAt,
    });
    this.track(assistant, state.tripId);
    state.messages.push(user, assistant);
    const response: SendTurnResponse = {
      messages: [user, assistant],
      quickReplies: assistant.quickReplies ?? [],
    };
    state.turns.set(req.clientTurnId, response);
    return response;
  }

  private scenarioOfAction(
    picked: QuickReply,
    state: SessionState
  ): AssistantScenario {
    const hasTrip = state.tripId !== null;
    switch (picked.action) {
      case 'REVIEW':
        return hasTrip ? 'review' : 'no-context';
      case 'PICK_CANDIDATE':
        return 'proposal';
      case 'SHOW_CAPABILITIES':
        return 'capabilities';
      case 'RETRY':
        return state.lastUserText
          ? routeUtterance(
              state.lastUserText.replace(/실패|검증/g, ''),
              hasTrip
            )
          : 'unknown';
      default:
        return routeUtterance(picked.label, hasTrip);
    }
  }

  async applyProposal(proposalId: string) {
    this.calls.applyProposal += 1;
    await delay(this.options.latencyMs ?? 0);
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'PROPOSED') {
      throw new AssistantApiError('NOT_APPLICABLE');
    }
    if (proposal.hasViolation) throw new AssistantApiError('NOT_APPLICABLE');
    const mode = this.options.apply ?? 'OK';
    if (mode !== 'OK') {
      if (mode !== 'NOT_APPLICABLE') this.setProposalStatus(proposalId, mode);
      throw new AssistantApiError(mode);
    }
    this.setProposalStatus(proposalId, 'APPLIED');
    const tripId = proposal.tripId ?? '';
    const log: AssistantMessage = {
      id: this.nextId('log'),
      role: 'ASSISTANT',
      kind: 'ACTION_LOG',
      text: '일정에 반영했어요.',
      payload: {
        what: '둘째 날 카페 교체',
        tag: 'CHANGE',
        detail: '카페 모카 → 책방카페 (솔버 검증)',
        revisionId: 'rev-fake',
      },
      nextActions: [
        { type: 'OPEN_ITINERARY', label: '일정 보기', params: { tripId } },
      ],
      createdAt: this.now(),
    };
    this.sessions.forEach((state) => {
      if (state.tripId === proposal.tripId) state.messages.push(log);
    });
    return {
      proposal: { id: proposalId, status: 'APPLIED' as const },
      messages: [log],
    };
  }

  async dismissProposal(proposalId: string) {
    this.calls.dismissProposal += 1;
    await delay(this.options.latencyMs ?? 0);
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'PROPOSED') {
      throw new AssistantApiError('NOT_APPLICABLE');
    }
    this.setProposalStatus(proposalId, 'DISMISSED');
    return { proposal: { id: proposalId, status: 'DISMISSED' as const } };
  }

  async clearSession(sessionId: string): Promise<void> {
    this.calls.clearSession += 1;
    await delay(this.options.latencyMs ?? 0);
    this.sessions.delete(sessionId);
  }
}

/** 이력 시연용 — 적용 기록 2건이 이미 있는 세션으로 연다(b06). */
export function fakeWithHistory(
  options: FakeAssistantOptions = {}
): FakeAssistantAdapter {
  return new FakeAssistantAdapter({
    ...options,
    seedMessages: sampleActionLogs(),
  });
}
