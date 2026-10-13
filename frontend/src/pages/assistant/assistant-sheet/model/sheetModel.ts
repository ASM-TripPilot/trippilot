import type { AssistantMessage, QuickReply } from '../api/assistantContract';
import { COMPOSER_LIMIT } from './composerLimit';

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

/** 서버가 이미 "내가 할 수 있는 것" quick reply 를 줬으면 상시 칩을 겹쳐 그리지 않는다. */
export function needsCapabilitiesChip(replies: readonly QuickReply[]): boolean {
  return !replies.some((reply) => reply.action === 'SHOW_CAPABILITIES');
}

/** 입력창 UX 사본(§7) — 1..500자, 공백만이면 불가. 금칙어 판정은 서버만(BR-U8-23). */
export function isSendableText(text: string): boolean {
  return text.trim().length > 0 && text.length <= COMPOSER_LIMIT;
}
