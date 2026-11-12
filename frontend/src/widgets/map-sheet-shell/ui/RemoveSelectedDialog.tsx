import type { ReactElement } from 'react';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

/**
 * TRIP-1791 · 편집기 「N곳 빼기」 확인창 — `shared/ui/ConfirmDialog` 틀에 문구만 얹은 위젯 비공개 래퍼.
 * 본문은 고른 곳 이름을 **슬롯 순서로** 앞 3곳 ` · ` 연결, 4곳째부터는 ` 외 N곳`.
 */

const NAME_LIMIT = 3;

function summarizeNames(all: string[]): string {
  const names = all.filter(Boolean); // nameKo 는 API 스키마상 비어 올 수 있다
  const head = names.slice(0, NAME_LIMIT).join(' · ');
  return names.length > NAME_LIMIT
    ? `${head} 외 ${names.length - NAME_LIMIT}곳`
    : head;
}

export function RemoveSelectedDialog({
  names,
  onConfirm,
  onCancel,
}: {
  names: string[];
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <ConfirmDialog
      testID="editor-select-confirm"
      title={`${names.length}곳을 일정에서 뺄까요?`}
      description={summarizeNames(names)}
      buttons={[
        {
          testID: 'editor-select-confirm-cancel',
          label: '취소',
          tone: 'outline',
          onPress: onCancel,
        },
        {
          testID: 'editor-select-confirm-ok',
          label: '빼기',
          tone: 'primary',
          onPress: onConfirm,
        },
      ]}
    />
  );
}
