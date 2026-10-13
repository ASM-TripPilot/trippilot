import { type ReactElement } from 'react';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

/**
 * TRIP-1095 · 저장 후 위반 요약 게이트(BR-U3-13) — 직접 짜기(h19)·일정 편집(h12·i07)이 PUT 응답에 위반이
 * 있을 때 띄운다. 제목 한 줄뿐이고 사유 원문·소요시간은 싣지 않는다(INV-3). 이 뷰는 콜백만 올리고, 잠금·
 * 이동·토스트는 페이지가 쥔다. 긍정 버튼 라벨만 화면별로 다르다(`confirmLabel`).
 *
 * `TripDeleteDialog` 와 같은 **조건부 렌더 absolute 오버레이** — 딤 실제 덮임·중앙 정렬·터치 차단은 jest
 * 원리적 사각(6-b 실기 전용, repo-traps). `@/shared/api` 를 물지 않는다.
 */
export function SaveConflictDialog({
  count,
  confirmLabel,
  onConfirm,
  onBack,
}: {
  count: number;
  confirmLabel: string;
  onConfirm: () => void;
  onBack: () => void;
}): ReactElement {
  return (
    <ConfirmDialog
      testID="itinerary-edit-save-conflict"
      cardTestID="itinerary-edit-save-conflict-card"
      title={`${count}곳에서 시간이 안 맞아요`}
      buttons={[
        {
          testID: 'itinerary-edit-save-back',
          label: '고치기',
          tone: 'outline',
          onPress: onBack,
        },
        {
          testID: 'itinerary-edit-save-asis',
          label: confirmLabel,
          tone: 'primary',
          onPress: onConfirm,
        },
      ]}
    />
  );
}
