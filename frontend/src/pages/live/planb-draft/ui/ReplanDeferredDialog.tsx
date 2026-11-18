import { type ReactElement } from 'react';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

/**
 * TRIP-1782 · 「다른 날 넣어 다시 짜기」 확인창 — 새 세션을 열면 지금 보던 초안이 닫힌다는 사실(INV-U4-06)을 확정 전에 말한다.
 * `ConfirmDialog` 래퍼(Figma 프레임 없음 — `ReplanLeaveDialog` 말투). 요청·잠금·실패 판정은 페이지가 쥐고 이 뷰는 콜백과
 * `failureText` 만 받는다(`failureText` 가 있으면 창을 안 닫고 안에 사유). 요청 중엔 두 버튼이 잠긴다.
 * 조건부 렌더 `absolute` 오버레이라 딤·중앙 정렬·터치 차단은 jest 사각(6-b 실기, repo-traps 오버레이 절).
 */
const TEST_ID = 'planb-draft-deferred-confirm';

export function ReplanDeferredDialog({
  pending,
  failureText,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  failureText: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <ConfirmDialog
      testID={TEST_ID}
      title="지금 초안은 적용되지 않고 닫혀요"
      titleTestID={`${TEST_ID}-title`}
      description="다른 날을 새로 다시 짜면 지금 보던 초안은 다시 볼 수 없어요. 원래 일정은 그대로예요"
      descriptionTestID={`${TEST_ID}-body`}
      descriptionSpacing="loose"
      size="md"
      errorText={failureText ?? undefined}
      errorTestID={`${TEST_ID}-error`}
      buttons={[
        {
          testID: `${TEST_ID}-cancel`,
          label: '취소',
          tone: 'outlineBody',
          onPress: onCancel,
          disabled: pending,
        },
        {
          testID: `${TEST_ID}-confirm`,
          label: '닫고 다시 짜기',
          tone: 'ink',
          onPress: onConfirm,
          disabled: pending,
        },
      ]}
    />
  );
}
