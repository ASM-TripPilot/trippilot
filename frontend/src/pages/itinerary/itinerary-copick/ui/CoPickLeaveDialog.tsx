import { type ReactElement } from 'react';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

/**
 * TRIP-1006 · 같이 짜기 이탈 확인(h09 컨셉 얼굴 ‹, 1곳 이상 골랐을 때만). 고른 곳은 확정마다 PUT 으로
 * 이미 저장돼 있어 나가도 잃는 것이 없다 — 그래서 문구는 "사라진다"가 아니라 저장 사실대로 말한다(Q2).
 * 제목·본문 문구는 정본·Figma 프레임이 없어 이 사이클이 정한 값이다.
 *
 * `features/settings/ui` 의 확인 다이얼로그 4종(`LogoutConfirmDialog` 등)과 같은 **조건부 렌더 absolute
 * 오버레이**다 — features 간 import 금지라 모양만 따른다. 딤 실제 덮임·중앙 정렬·터치 차단은 jest 원리적
 * 사각(6-b 실기 전용, repo-traps).
 */
export function CoPickLeaveDialog({
  pickedCount,
  onStay,
  onLeave,
}: {
  pickedCount: number;
  onStay: () => void;
  onLeave: () => void;
}): ReactElement {
  return (
    <ConfirmDialog
      testID="itinerary-copick-leave-confirm"
      title="같이 짜기를 멈출까요?"
      description={`고른 ${pickedCount}곳은 저장돼 있어요. 나머지는 AI가 고른 그대로 남아요.`}
      descriptionSpacing="loose"
      size="md"
      buttons={[
        {
          testID: 'itinerary-copick-leave-confirm-stay',
          label: '머무르기',
          tone: 'outlineBody',
          onPress: onStay,
        },
        {
          testID: 'itinerary-copick-leave-confirm-leave',
          label: '나가기',
          tone: 'ink',
          onPress: onLeave,
        },
      ]}
    />
  );
}
