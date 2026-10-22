import type {
  AssistantMessage,
  AssistantSurface,
  QuickReply,
} from '../api/assistantContract';
import { COMPOSER_LIMIT } from './composerLimit';
import { CAPABILITIES_LABEL } from './displayActions';

/**
 * 시트 표시용 순수 계산(TRIP-1322) — page 가 한 번 부르고 뷰에 값으로 내린다.
 */

/** 지금 보일 quick reply — 마지막 도우미 메시지가 실은 것, 없으면 세션 열기 응답의 시작 quick reply. */
export function currentQuickReplies(
  messages: readonly AssistantMessage[],
  sessionReplies: readonly QuickReply[]
): QuickReply[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'ASSISTANT') {
      return [...(message.quickReplies ?? sessionReplies)];
    }
  }
  return [...sessionReplies];
}

/** quick reply 분류 결과(TRIP-1567) — 칩 안 펼침 항목과 카드 위 한 줄에 남는 응답 보기. */
export interface SplitQuickReplies {
  /** 칩 안 펼침 항목 — 일반 질문형. SHOW_CAPABILITIES 가 앞, 나머지는 입력 순서. */
  suggestions: QuickReply[];
  /** 카드 위 한 줄에 남는 응답 보기 — PICK_OPTION·RETRY, 입력 순서. */
  choices: QuickReply[];
}

/**
 * quick reply 를 둘로 가른다(TRIP-1567). PICK_CANDIDATE(후보 카드가 고르기 담당)와 모르는 action 은 어디에도 안 보낸다 —
 * 모르는 종류는 응답에 묶인 답인지 질문인지 클라가 모르므로 닫힌 목록으로만 그린다.
 */
export function splitQuickReplies(
  replies: readonly QuickReply[]
): SplitQuickReplies {
  const capabilities = replies.filter((r) => r.action === 'SHOW_CAPABILITIES');
  const asks = replies.filter(
    (r) => r.action === 'SEND_TEXT' || r.action === 'REVIEW'
  );
  return {
    suggestions: [...capabilities, ...asks],
    choices: replies.filter(
      (r) => r.action === 'PICK_OPTION' || r.action === 'RETRY'
    ),
  };
}

/** 서버가 이미 "내가 할 수 있는 것" quick reply 를 줬으면 상시 칩을 겹쳐 그리지 않는다. */
export function needsCapabilitiesChip(replies: readonly QuickReply[]): boolean {
  return !replies.some((reply) => reply.action === 'SHOW_CAPABILITIES');
}

/** 입력창 UX 사본(§7) — 1..500자, 공백만이면 불가. 금칙어 판정은 서버만(BR-U8-23). */
export function isSendableText(text: string): boolean {
  return text.trim().length > 0 && text.length <= COMPOSER_LIMIT;
}

const SURFACE_CHIP_LABEL: Record<AssistantSurface, string> = {
  ITINERARY: '이 일정에 관해 질문하기',
  LIVE: '이 일정에 관해 질문하기',
  STAY_DETAIL: '이 숙소에 관해 질문하기',
  STAY_SEARCH: '이 검색 결과에 관해 질문하기',
  // HOME 이라도 READY 면 진행 중 여행이 있다 — 일정 라벨(능력 보기는 NO_CONTEXT 만, 6-b 실기 결함 정정).
  HOME: '이 일정에 관해 질문하기',
};

/** 입력 카드 위 컨텍스트 칩의 보이는 문구 — 여행 없음(NO_CONTEXT)이 surface 보다 먼저다. */
export function contextChipLabel(
  surface: AssistantSurface,
  noContext: boolean
): string {
  return noContext ? CAPABILITIES_LABEL : SURFACE_CHIP_LABEL[surface];
}
