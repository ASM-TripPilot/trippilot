import { useRef, useState } from 'react';

import type {
  AssistantMessage,
  FeedbackRating,
  FeedbackReason,
  FeedbackRequest,
} from '../api/assistantContract';
import {
  canSubmitComment,
  normalizeComment,
  toggleRating,
  type FeedbackPanel,
} from './answerFeedback';
import { useMessageFeedback } from './assistantQueries';

/**
 * 답 평가 줄의 상태(US-ASSIST-09). 평가 값의 정본은 메시지 캐시다(`useMessageFeedback` — 낙관 갱신·롤백). 여기는
 * 서버가 모르는 화면 상태만 메시지 id 별로 쥔다: 펼친 이유 칸·쓰던 의견·실패 안내·보내는 중.
 *
 * - 같은 엄지를 다시 누르면 취소(DELETE), 반대쪽이면 바꾸기(PUT) — `toggleRating`.
 * - 싫어요가 되면 그 답 아래 이유 칸을 편다. 칩은 그 이유로 바로 보내고, "직접 적기"는 [보내기]가 이유(골랐으면)와
 *   의견을 함께 보낸다. 보내면 칸을 접고 고마워요 안내를 남긴다(낙관).
 * - 실패하면 칸을 누르기 전 모양으로 되돌리고 안내한다(침묵 실패 금지 — 쓰던 의견도 돌아온다).
 * - 메시지마다 요청은 한 번에 하나 — 겹치면 캐시를 되돌릴 값이 꼬인다. 같은 틱 연타는 ref 로 막고, 보내는 동안
 *   그 답의 엄지·칩은 state(`busyOf`)로 비활성으로 그린다.
 */

const SAVE_FAILED = '평가를 저장하지 못했어요. 잠시 후 다시 시도해 주세요';
const SEND_FAILED = '의견을 보내지 못했어요. 잠시 후 다시 시도해 주세요';

export interface AnswerFeedbackFlow {
  panelOf: (messageId: string) => FeedbackPanel | null;
  errorOf: (messageId: string) => string | null;
  busyOf: (messageId: string) => boolean;
  pressThumb: (message: AssistantMessage, pressed: FeedbackRating) => void;
  pickReason: (messageId: string, reason: FeedbackReason) => void;
  openComment: (messageId: string) => void;
  changeComment: (messageId: string, text: string) => void;
  submitComment: (messageId: string) => void;
}

/** 메시지 id 칸 하나를 갈아 끼운다 — null 이면 뺀다. */
function withEntry<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  value: T | null
): Readonly<Record<string, T>> {
  const next = { ...record };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

export function useAnswerFeedback(
  sessionId: string | undefined
): AnswerFeedbackFlow {
  const feedback = useMessageFeedback(sessionId);
  const [panels, setPanels] = useState<Readonly<Record<string, FeedbackPanel>>>(
    {}
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState<Readonly<Record<string, true>>>({});
  const busyRef = useRef(new Set<string>());

  function setPanel(messageId: string, panel: FeedbackPanel | null): void {
    setPanels((prev) => withEntry(prev, messageId, panel));
  }

  function locked(messageId: string): boolean {
    return !sessionId || busyRef.current.has(messageId);
  }

  /** 보낸다 — 실패하면 칸을 `restore` 로 되돌리고 안내한다(평가 값 롤백은 `useMessageFeedback` 몫). */
  function send(
    messageId: string,
    request: FeedbackRequest | null,
    restore: FeedbackPanel | null,
    failText: string
  ): void {
    busyRef.current.add(messageId);
    setBusy((prev) => withEntry(prev, messageId, true));
    setErrors((prev) => withEntry(prev, messageId, null));
    // 메시지마다 결과를 따로 받으려고 mutateAsync 다 — `mutate(…, {onError})` 의 호출별 콜백은 겹친 호출 중
    // 마지막 것에만 불린다(TanStack v5). 다른 답의 평가가 겹치면 앞 답의 잠금이 안 풀린다.
    void feedback
      .mutateAsync({ messageId, request })
      .catch(() => {
        setPanel(messageId, restore);
        setErrors((prev) => withEntry(prev, messageId, failText));
      })
      .finally(() => {
        busyRef.current.delete(messageId);
        setBusy((prev) => withEntry(prev, messageId, null));
      });
  }

  function pressThumb(
    message: AssistantMessage,
    pressed: FeedbackRating
  ): void {
    if (locked(message.id)) return;
    const next = toggleRating(message.feedback ?? null, pressed);
    const before = panels[message.id] ?? null;
    setPanel(message.id, next === 'DOWN' ? { step: 'REASONS' } : null);
    send(
      message.id,
      next === null ? null : { rating: next, reason: null, comment: null },
      before,
      SAVE_FAILED
    );
  }

  function pickReason(messageId: string, reason: FeedbackReason): void {
    const panel = panels[messageId];
    if (locked(messageId) || !panel) return;
    if (panel.step === 'WRITING') {
      // 쓰는 중엔 고르기만 한다(다시 누르면 풂) — [보내기]가 의견과 함께 보낸다.
      setPanel(messageId, {
        ...panel,
        reason: panel.reason === reason ? null : reason,
      });
      return;
    }
    if (panel.step !== 'REASONS') return;
    setPanel(messageId, { step: 'THANKS' });
    send(
      messageId,
      { rating: 'DOWN', reason, comment: null },
      panel,
      SEND_FAILED
    );
  }

  function openComment(messageId: string): void {
    if (locked(messageId) || panels[messageId]?.step !== 'REASONS') return;
    setPanel(messageId, { step: 'WRITING', reason: null, comment: '' });
  }

  function changeComment(messageId: string, text: string): void {
    const panel = panels[messageId];
    if (panel?.step === 'WRITING') {
      setPanel(messageId, { ...panel, comment: text });
    }
  }

  function submitComment(messageId: string): void {
    const panel = panels[messageId];
    if (
      locked(messageId) ||
      panel?.step !== 'WRITING' ||
      !canSubmitComment(panel)
    ) {
      return;
    }
    setPanel(messageId, { step: 'THANKS' });
    send(
      messageId,
      {
        rating: 'DOWN',
        reason: panel.reason,
        comment: normalizeComment(panel.comment),
      },
      panel,
      SEND_FAILED
    );
  }

  return {
    panelOf: (messageId) => panels[messageId] ?? null,
    errorOf: (messageId) => errors[messageId] ?? null,
    busyOf: (messageId) => busy[messageId] === true,
    pressThumb,
    pickReason,
    openComment,
    changeComment,
    submitComment,
  };
}
