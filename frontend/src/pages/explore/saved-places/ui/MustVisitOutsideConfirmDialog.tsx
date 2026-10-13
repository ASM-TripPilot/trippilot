import { type ReactElement } from 'react';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

/**
 * TRIP-1106 · 꼭 갈 곳 고르기(위저드) 완료 때 지역 밖 선택이 섞여 있으면 띄우는 확인. 제목 한 줄뿐이고
 * 왼쪽 외곽선 [빼고 완료] · 오른쪽 코랄 [그대로 넣기]다(결정 2 — `SaveConflictDialog` 토큰 복제, 형제
 * feature 라 import 하지 않고 다시 그렸다). 콜백만 올리고, 열림·연타 잠금·시드·이동은 페이지가 쥔다.
 *
 * 조건부 렌더 absolute 오버레이라 딤 실제 덮임·중앙 정렬·터치 차단은 jest 원리적 사각(6-b 실기 전용,
 * repo-traps).
 */
export function MustVisitOutsideConfirmDialog({
  count,
  onExclude,
  onKeep,
}: {
  count: number;
  onExclude: () => void;
  onKeep: () => void;
}): ReactElement {
  return (
    <ConfirmDialog
      testID="mustvisit-pick-outside-confirm"
      cardTestID="mustvisit-pick-outside-confirm-card"
      title={`이 여행 지역 밖 ${count}곳이 함께 들어가요`}
      buttons={[
        {
          testID: 'mustvisit-pick-outside-exclude',
          label: '빼고 완료',
          tone: 'outline',
          onPress: onExclude,
        },
        {
          testID: 'mustvisit-pick-outside-keep',
          label: '그대로 넣기',
          tone: 'primary',
          onPress: onKeep,
        },
      ]}
    />
  );
}
