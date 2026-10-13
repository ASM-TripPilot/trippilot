import { type ReactElement } from 'react';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

/**
 * TRIP-1114 · g01 위저드 **이탈 확인**(US-TRIP-10 확정 전 아무것도 안 지움 · INV-4 실패 안내).
 * Figma 프레임이 없어 `BaseRegenerateDialog` 토큰을 복제했다. 3버튼 세로 쌓기·강조 배정(저장=코랄,
 * 삭제=아웃라인, 계속 작성=텍스트)과 제목·본문 문구는 발명값(01b Q1·Q2). 실패 문구는 `TripDeleteDialog`
 * 와 같다. [계속 작성] 글자는 같은 화면 국내 밖 다이얼로그 `닫기` 와 같다. 뷰 전용 — 열림·요청·이동은 `TripNewStep1Page` 몫.
 *
 * 조건부 렌더 absolute 오버레이라 딤 실제 덮임·중앙 정렬·터치 차단은 jest 원리적 사각(6-b 전용).
 */
export function TripWizardLeaveDialog({
  failed,
  onSave,
  onDelete,
  onStay,
}: {
  failed?: boolean;
  onSave: () => void;
  onDelete: () => void;
  onStay: () => void;
}): ReactElement {
  return (
    <ConfirmDialog
      testID="trip-wizard-leave-dialog"
      cardTestID="trip-wizard-leave-card"
      title="여행 만들기를 그만둘까요?"
      description="저장하면 내 여행에 작성 중으로 남아요. 삭제하면 되돌릴 수 없어요."
      descriptionSpacing="loose"
      errorText={failed ? '삭제하지 못했어요. 다시 시도해 주세요.' : undefined}
      errorTestID="trip-wizard-leave-error"
      size="md"
      buttons={[
        {
          testID: 'trip-wizard-leave-save',
          label: '저장하고 나가기',
          tone: 'primaryOn',
          onPress: onSave,
        },
        {
          testID: 'trip-wizard-leave-delete',
          label: '삭제하고 나가기',
          tone: 'outlineBody',
          onPress: onDelete,
        },
        {
          testID: 'trip-wizard-leave-stay',
          label: '계속 작성',
          tone: 'text',
          onPress: onStay,
        },
      ]}
    />
  );
}
