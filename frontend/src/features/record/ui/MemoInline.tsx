import type { ReactElement } from 'react';
import { useState } from 'react';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';

/**
 * TRIP-566 · AC-5(메모 UX) · BR-U5-13 — 방문 메모 인라인 입력(1개, PUT upsert 는 배선 훅 소관).
 *
 * 무엇을 보장하나:
 *  - 본문 없으면 placeholder "메모를 남겨보세요"(정본), 있으면 VM 으로 받은 텍스트(PUT 후 낙관값)를 초기 표시.
 *  - 제출 시 공백만이면 **저장 콜백 0회**(무의미 PUT 방지) · 유효하면 trim 후 onSubmit 1회.
 *
 * TRIP-1078 · 제출 = **포커스가 빠질 때(onBlur) 하나뿐**. iOS 여러 줄 입력의 return 은 submitEditing 을
 *   내지 않아(#064) 그 이벤트에 건 저장은 실기에서 한 번도 안 불렸다. `submitBehavior="blurAndSubmit"` 로
 *   return 을 "완료"(키보드 내림 → blur)로 바꾸고, 탭·스크롤 등 다른 이탈도 blur 가 받는다. onSubmitEditing 에
 *   따로 저장을 걸면 return 한 번에 저장이 2회라 걸지 않는다. 같은 값 반복 차단은 성공을 아는 훅 몫.
 *
 * TRIP-1085 · 입력은 `BottomSheetTextInput` — 카드가 j01 셸 바텀시트 안에 있어 포커스 때 시트가 키보드 위로
 *   올라가야 한다(플레인 TextInput 이면 입력칸이 키보드에 가린다). ⚠️ 이 입력은 시트 밖에서 그리면 실기에서
 *   throw 한다(`useBottomSheetInternal`) — j01 셸 시트 안에서만 쓴다(프리뷰 포함 — 기계 강제 없음, 실기 스모크 몫).
 *
 * ★ maxLength 2000 은 서버 권위(`PutMemoRequest.text` 1~2000)의 **클라 UX 사본**(과입력 방지)일 뿐 —
 *   룰 판정 권위는 서버다. 공백만 무저장도 UX(무의미 PUT 방지)지 비즈니스 판정이 아니다.
 */

export interface MemoInlineProps {
  text?: string | null;
  onSubmit?: (text: string) => void;
  /** TRIP-1117 — 초안이 바뀔 때마다(글자 수 표시용, i01 허브 메모 시트). */
  onChangeDraft?: (draft: string) => void;
  /** TRIP-1117 — 입력 모양 덮어쓰기(허브 시트는 Figma 14px·상자 안). 미지정이면 j01 모양 그대로. */
  className?: string;
}

export function MemoInline({
  text,
  onSubmit,
  onChangeDraft,
  className = 'min-h-[44px] py-sm font-noto text-label text-ink',
}: MemoInlineProps): ReactElement {
  const [draft, setDraft] = useState(text ?? '');

  const handleSubmit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === '') return;
    onSubmit?.(trimmed);
  };

  return (
    <BottomSheetTextInput
      testID="record-trip-memo-input"
      value={draft}
      onChangeText={(next) => {
        setDraft(next);
        onChangeDraft?.(next);
      }}
      onBlur={handleSubmit}
      submitBehavior="blurAndSubmit"
      placeholder="메모를 남겨보세요"
      placeholderTextColor="#9AA1AB"
      maxLength={2000}
      multiline
      className={className}
    />
  );
}
