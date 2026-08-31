import type { ReactElement } from 'react';
import { useState } from 'react';
import { TextInput } from 'react-native';

/**
 * TRIP-566 · AC-5(메모 UX) · BR-U5-13 — 방문 메모 인라인 입력(1개, PUT upsert 는 배선 훅 소관).
 *
 * 무엇을 보장하나:
 *  - 본문 없으면 placeholder "메모를 남겨보세요"(정본), 있으면 VM 으로 받은 텍스트(PUT 후 낙관값)를 초기 표시.
 *  - 제출 시 공백만이면 **저장 콜백 0회**(무의미 PUT 방지) · 유효하면 trim 후 onSubmit 1회.
 *
 * ★ maxLength 2000 은 서버 권위(`PutMemoRequest.text` 1~2000)의 **클라 UX 사본**(과입력 방지)일 뿐 —
 *   룰 판정 권위는 서버다. 공백만 무저장도 UX(무의미 PUT 방지)지 비즈니스 판정이 아니다.
 */

export interface MemoInlineProps {
  text?: string | null;
  onSubmit?: (text: string) => void;
}

export function MemoInline({ text, onSubmit }: MemoInlineProps): ReactElement {
  const [draft, setDraft] = useState(text ?? '');

  const handleSubmit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === '') return;
    onSubmit?.(trimmed);
  };

  return (
    <TextInput
      testID="record-trip-memo-input"
      value={draft}
      onChangeText={setDraft}
      onSubmitEditing={handleSubmit}
      placeholder="메모를 남겨보세요"
      placeholderTextColor="#9AA1AB"
      maxLength={2000}
      multiline
      className="min-h-[44px] rounded-input border border-hairline bg-surface-soft px-md py-sm font-noto text-label text-ink"
    />
  );
}
