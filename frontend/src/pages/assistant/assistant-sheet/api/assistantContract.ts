/**
 * U8 AI 도우미 와이어 계약 — 손으로 옮긴 타입(TRIP-1319).
 *
 * 원천: `aidlc/.../u8-conversational-assistant/functional-design/frontend-components.md` §6(DTO)·
 * `domain-entities.md` §3.4(MessageKind·NextAction·QuickReply)·§3.5(제안 상태기계).
 * `backend/docs/design/openapi.yaml` 에 assistant 태그가 0건이라 orval 코드젠 대상이 아니다 — BE 가
 * 계약을 올리면 `shared/api/generated` 타입으로 갈아끼우고 이 파일을 지운다.
 *
 * INV-3: 어떤 타입에도 소요시간(`duration`) 필드가 없다. 시각·거리는 서버 문자열 그대로다(INV-2).
 */

/** 도우미를 연 화면 — 앱이 보내는 문맥은 이것과 tripId 뿐이다(BR-U8-02). */
export type AssistantSurface =
  'HOME' | 'STAY_SEARCH' | 'ITINERARY' | 'LIVE' | 'STAY_DETAIL';

export const ASSISTANT_SURFACES: readonly AssistantSurface[] = [
  'HOME',
  'STAY_SEARCH',
  'ITINERARY',
  'LIVE',
  'STAY_DETAIL',
];

export type MessageRole = 'USER' | 'ASSISTANT';

export type MessageKind =
  | 'TEXT'
  | 'CLARIFY'
  | 'REVIEW'
  | 'CANDIDATES'
  | 'PROPOSAL'
  | 'INFO'
  | 'SCOPE'
  | 'REFUSAL'
  | 'FALLBACK'
  | 'ACTION_LOG';

/** closed-set(domain-entities §3.4). 서버가 모르는 값을 보내도 앱은 그리지 않는다(BR-U8-06). */
export const NEXT_ACTION_TYPES = [
  'OPEN_ITINERARY',
  'OPEN_ITINERARY_EDIT',
  'OPEN_ITINERARY_METHOD',
  'OPEN_REGENERATE',
  'OPEN_REPLAN',
  'OPEN_LIVE',
  'OPEN_PLACE',
  'OPEN_STAY_SEARCH',
  'OPEN_OTA',
  'OPEN_REFLECTION',
  'OPEN_TRIP_SUMMARY',
  'OPEN_STYLE',
  'CREATE_TRIP',
  'RETRY_TURN',
  'CONTINUE_WITHOUT_ASSISTANT',
  'SHOW_CAPABILITIES',
  'RESTORE_REVISION',
] as const;

export type NextActionType = (typeof NEXT_ACTION_TYPES)[number];

/** 와이어 값 — `type` 은 서버가 보낸 문자열 그대로(모르는 값 가능). */
export interface NextAction {
  type: string;
  label: string;
  params: Record<string, string>;
}

export type QuickReplyAction =
  | 'SEND_TEXT'
  | 'REVIEW'
  | 'PICK_CANDIDATE'
  | 'PICK_OPTION'
  | 'SHOW_CAPABILITIES'
  | 'RETRY';

/** 서버 발급 quick reply — 클라는 만들지 않는다(SHOW_CAPABILITIES 상시 하나만 예외, BR-U8-04). */
export interface QuickReply {
  id: string;
  label: string;
  action: QuickReplyAction;
  params: Record<string, string>;
}

export type ProposalStatus =
  'PROPOSED' | 'APPLIED' | 'STALE' | 'DISMISSED' | 'EXPIRED' | 'FAILED';

export type ProposalChange =
  'ADDED' | 'REMOVED' | 'REPLACED' | 'MOVED' | 'RETIMED';

/** 비교 카드 한 칸 — 시각·거리는 ai 조립이 검증한 문자열(BR-U8-35). */
export interface ProposalSlotFace {
  name: string;
  startAt: string;
  /** 직전 구간 거리 문자열(예 '840m'). 없으면 거리 줄을 그리지 않는다. */
  distanceRange?: string | null;
}

export interface ProposalDiffItem {
  change: ProposalChange;
  slotKey: string;
  before?: ProposalSlotFace | null;
  after?: ProposalSlotFace | null;
}

export interface Proposal {
  id: string;
  status: ProposalStatus;
  diff: ProposalDiffItem[];
  /** 비어 있지 않으면 적용 불가 — 서버가 이미 판정했다(BR-U8-31). */
  violations: string[];
  applyHint: 'AUTO_APPLY' | 'CONFIRM_REQUIRED' | null;
}

/** 라벨·값 한 줄 — 서버가 지은 문자열 그대로(진행 검토 요약·정보 카드). */
export interface LabeledValue {
  label: string;
  value: string;
}

export interface ReviewProblem {
  slotKey?: string | null;
  /** 솔버가 표기한 위반 사유 또는 구조적 사실 문구(BR-U8-14). */
  reason: string;
  fixAction: NextAction;
}

export interface ReviewPayload {
  title: string;
  summary: LabeledValue[];
  problems: ReviewProblem[];
}

export interface CandidateItem {
  poiId: string;
  name: string;
  distanceRange?: string | null;
  reason: string;
}

export interface CandidatesPayload {
  candidates: CandidateItem[];
}

export type InfoKind = 'NEXT_SLOT' | 'DISTANCE' | 'PLACE' | 'WEATHER';

export interface InfoPayload {
  infoKind: InfoKind;
  title: string;
  rows: LabeledValue[];
}

export interface ScopePayload {
  reason: string;
  /** 외부 위임 대상(숙소 문맥이면 숙소 이름) — 없으면 카드 없이 문구만. */
  alternative?: { title: string; caption: string } | null;
}

export interface RefusalPayload {
  category: string;
  /** "제가 할 수 있는 것" 한 줄 — 서버 템플릿. */
  capabilities: string;
}

export type FallbackCause =
  | 'AI_UNAVAILABLE'
  | 'SOLVER_UNAVAILABLE'
  | 'SOURCE_UNAVAILABLE'
  | 'TRANSLATION_FAILED'
  | 'REJECTED';

export interface FallbackPayload {
  cause: FallbackCause;
  /** 경고 상자 문구(서버 템플릿). 없으면 메시지 text 만. */
  notice?: string | null;
}

export type ActionLogTag = 'FILTER' | 'CHANGE' | 'REVIEW';

export interface ActionLogPayload {
  /** 행 제목 — 예 '오늘 14:25 · 3일차 카페 교체'(서버 문자열). */
  what: string;
  tag?: ActionLogTag | null;
  detail?: string | null;
  revisionId?: string | null;
  changeLogEntryId?: string | null;
}

export interface ClarifyPayload {
  argument: string;
  question: string;
  options?: string[] | null;
}

export type MessagePayload =
  | ReviewPayload
  | CandidatesPayload
  | InfoPayload
  | ScopePayload
  | RefusalPayload
  | FallbackPayload
  | ActionLogPayload
  | ClarifyPayload;

export interface AssistantMessage {
  id: string;
  role: MessageRole;
  kind: MessageKind;
  text?: string | null;
  payload?: MessagePayload | null;
  nextActions: NextAction[];
  quickReplies?: QuickReply[] | null;
  proposal?: Proposal | null;
  /** 카드 아래 회색 각주(Figma `* …`) — 서버 템플릿. */
  footnote?: string | null;
  createdAt: string;
}

export interface AssistantSession {
  id: string;
  tripId: string | null;
  /** 사용한 컨텍스트 칩 문구 — 서버가 스냅샷과 같은 원천으로 만든다(BR-U8-03). null 이면 무컨텍스트(b07). */
  contextChip: string | null;
}

export interface OpenSessionResponse {
  session: AssistantSession;
  messages: AssistantMessage[];
  quickReplies: QuickReply[];
}

export interface AssistantSessionSummary {
  id: string;
  tripId: string | null;
  tripTitle?: string | null;
  lastTurnAt: string;
}

export interface MessagesPage {
  messages: AssistantMessage[];
  nextBefore?: string | null;
}

export type TurnInput =
  { type: 'TEXT'; text: string } | { type: 'ACTION'; quickReplyId: string };

export interface SendTurnRequest {
  clientTurnId: string;
  input: TurnInput;
  screen: { surface: AssistantSurface };
}

export interface SendTurnResponse {
  /** USER 1 + ASSISTANT ≥1. */
  messages: AssistantMessage[];
  quickReplies: QuickReply[];
}

export interface ApplyProposalResponse {
  proposal: { id: string; status: ProposalStatus };
  messages: AssistantMessage[];
}

export interface DismissProposalResponse {
  proposal: { id: string; status: ProposalStatus };
}
