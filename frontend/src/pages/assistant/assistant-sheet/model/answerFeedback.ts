import type { FeedbackRating, FeedbackReason } from '../api/assistantContract';

/**
 * 답 평가 순수 판정(US-ASSIST-09). 서버는 남기기·바꾸기(PUT)와 취소(DELETE)만 안다 — "같은 엄지를 다시 누르면
 * 취소"는 앱이 고른다(BR-U8-60). 의견 정규화는 서버 규칙(앞뒤 공백 제거·비면 null)의 UX 사본이다.
 */

/** 엄지를 누른 뒤의 평가 — 같은 쪽이면 취소(null = DELETE), 아니면 누른 쪽(PUT). */
export function toggleRating(
  current: FeedbackRating | null,
  pressed: FeedbackRating
): FeedbackRating | null {
  return current === pressed ? null : pressed;
}

/** 앞뒤 공백을 떼고, 남는 게 없으면 null. */
export function normalizeComment(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/** 직접 적기 [보내기] — 의견이나 이유 중 하나는 있어야 보낸다(둘 다 없으면 이미 남긴 싫어요와 같다). */
export function canSubmitComment(draft: {
  reason: FeedbackReason | null;
  comment: string;
}): boolean {
  return draft.reason !== null || normalizeComment(draft.comment) !== null;
}

/**
 * 싫어요 뒤 그 답 아래에 펴는 칸(화면 로컬 — 서버가 모르는 UI 상태). 없으면(null) 접힘.
 * - `REASONS`: 이유 칩 셋 + "직접 적기" — 칩을 누르면 그 이유로 바로 보낸다.
 * - `WRITING`: 칩 + 의견 입력 — 칩은 고르기만 하고, [보내기]가 이유(골랐으면)와 의견을 함께 보낸다.
 * - `THANKS`: 보낸 뒤 짧은 안내만 남긴다.
 */
export type FeedbackPanel =
  | { step: 'REASONS' }
  | { step: 'WRITING'; reason: FeedbackReason | null; comment: string }
  | { step: 'THANKS' };
