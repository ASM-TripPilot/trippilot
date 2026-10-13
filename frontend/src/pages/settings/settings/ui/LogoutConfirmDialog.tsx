import { type ReactElement } from 'react';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

/**
 * TRIP-938 · 로그아웃 확인 다이얼로그(1단). `BaseToggleDialog`·`RevokeConfirmDialog` 와 동형으로 리포 Modal
 * 선례 없이 **조건부 렌더 absolute 오버레이**다 — 열림 시 testID 가 트리에 실재한다(딤 실제 덮임·중앙
 * 정렬은 jest 원리적 사각, 6-b 실기 전용 · repo-traps). [로그아웃]을 눌러야 `onConfirm` 이 나간다.
 */
export function LogoutConfirmDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <ConfirmDialog
      testID="logout-confirm"
      title="로그아웃할까요?"
      size="sm"
      shadow="none"
      buttonsTopClassName="mt-2xl"
      buttons={[
        {
          testID: 'logout-cancel',
          label: '취소',
          tone: 'outline',
          onPress: onCancel,
        },
        {
          testID: 'logout-confirm-button',
          label: '로그아웃',
          tone: 'ink',
          onPress: onConfirm,
        },
      ]}
    />
  );
}
