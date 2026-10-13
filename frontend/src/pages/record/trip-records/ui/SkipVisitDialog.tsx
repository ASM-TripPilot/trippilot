import { type ReactElement } from 'react';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

/**
 * TRIP-1069 · j01 건너뛰기 확인(결정 3(c)). 건너뛴 방문은 되돌릴 수 없고 완료로 바꿀 수 없다(BR-U5-06) —
 * 확정 전에는 아무 요청도 없다. 이 뷰는 콜백만 올리고 요청·실패 판정은 페이지가 쥔다. `failed` 면 닫지 않고
 * 안에 실패 문구를 띄운다(INV-4). `pending`(확정 뒤 응답 전)엔 두 버튼을 막는다 — 취소했다고 믿었는데 건너뛰어지는
 * 일, 늦은 결과가 다른 카드의 다이얼로그를 덮는 일을 막는다(03b W1).
 *
 * Figma 프레임이 없어 `TripDeleteDialog`(features/itinerary) 토큰을 복제했다 — features 간 import 금지.
 * 조건부 렌더 absolute 오버레이라 딤 덮임·중앙 정렬·터치 차단은 jest 원리적 사각(6-b 실기, repo-traps).
 */
export function SkipVisitDialog({
  pending,
  failed,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  failed: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <ConfirmDialog
      testID="record-visit-skip-dialog"
      title="이 방문을 건너뛸까요?"
      description="건너뛴 곳은 되돌리거나 완료로 바꿀 수 없어요."
      hangulBreak
      errorText={failed ? '건너뛰지 못했어요. 다시 시도해 주세요.' : undefined}
      errorTestID="record-visit-skip-dialog-error"
      buttons={[
        {
          testID: 'record-visit-skip-dialog-cancel',
          label: '취소',
          tone: 'outline',
          onPress: onCancel,
          disabled: pending,
        },
        {
          testID: 'record-visit-skip-dialog-confirm',
          label: '건너뛰기',
          tone: 'primary',
          onPress: onConfirm,
          disabled: pending,
        },
      ]}
    />
  );
}
