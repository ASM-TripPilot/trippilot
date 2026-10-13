import { type ReactElement } from 'react';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

/**
 * TRIP-1055 · h06 작성중 여행 삭제 확인(Figma 4682:3206). 확정 전에는 아무것도 지우지 않는다(US-TRIP-10) —
 * 이 뷰는 콜백만 올리고, 요청·잠금·실패 판정은 페이지(`MyTripsListPage`)가 쥔다. `failed` 면 다이얼로그를
 * 닫지 않고 안에 실패 문구를 띄운다(01b Q4 · INV-4).
 *
 * `CoPickLeaveDialog` 와 같은 **조건부 렌더 absolute 오버레이** — 딤 실제 덮임·중앙 정렬·터치 차단은 jest
 * 원리적 사각(6-b 실기 전용, repo-traps). 프리뷰가 네트워크 계층을 전이 로드하지 않게 `@/shared/api` 를 물지
 * 않는다.
 */
export function TripDeleteDialog({
  failed,
  onCancel,
  onConfirm,
}: {
  failed: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <ConfirmDialog
      testID="my-trip-delete-dialog"
      cardTestID="my-trip-delete-dialog-card"
      title="이 여행을 삭제할까요?"
      // Figma 는 '지워지고' 뒤 강제 줄바꿈이지만 본문은 한 문자열 계약(완전 일치) — 어절 단위 줄바꿈으로
      // '요.' 한 글자 고아 줄만 막는다.
      description="작성 중인 일정도 함께 지워지고 되돌릴 수 없어요."
      hangulBreak
      errorText={failed ? '삭제하지 못했어요. 다시 시도해 주세요.' : undefined}
      errorTestID="my-trip-delete-error"
      buttons={[
        {
          testID: 'my-trip-delete-cancel',
          label: '취소',
          tone: 'outline',
          onPress: onCancel,
        },
        {
          testID: 'my-trip-delete-confirm',
          label: '삭제',
          tone: 'primary',
          onPress: onConfirm,
        },
      ]}
    />
  );
}
