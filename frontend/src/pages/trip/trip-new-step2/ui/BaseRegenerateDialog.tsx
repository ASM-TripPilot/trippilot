import { type ReactElement } from 'react';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

/**
 * TRIP-1082 · g02 거점 편집 후 **일정 재생성 묻기**(Figma `4700:2747`, BR-U6-21 "묻는다·조용히 재생성
 * 금지"). 코랄(주 강조)은 기본·안전한 [그대로 두기], [일정 다시 만들기]는 편집분이 사라질 수 있는
 * 파괴적 선택이라 아웃라인이다. 뷰 전용 — 열림·이동은 `TripBasesPage` 몫.
 *
 * 레이아웃은 `BaseToggleDialog` 와 같은 **조건부 렌더 absolute 오버레이**다(딤 실제 덮임·중앙 정렬·
 * 터치 차단은 jest 원리적 사각 — 6-b 실기 전용).
 */
export function BaseRegenerateDialog({
  onKeep,
  onRegenerate,
}: {
  onKeep: () => void;
  onRegenerate: () => void;
}): ReactElement {
  return (
    <ConfirmDialog
      testID="trip-base-regen-dialog"
      cardTestID="trip-base-regen-card"
      title="일정도 다시 만들까요?"
      description="거점 숙소가 바뀌었어요. 일정은 그대로 둘 수 있어요. 다시 만들면 직접 고친 내용은 사라질 수 있어요."
      descriptionSpacing="loose"
      size="md"
      buttons={[
        {
          testID: 'trip-base-regen-confirm',
          label: '일정 다시 만들기',
          tone: 'outlineBody',
          onPress: onRegenerate,
        },
        {
          testID: 'trip-base-regen-keep',
          label: '그대로 두기',
          tone: 'primaryOn',
          onPress: onKeep,
        },
      ]}
    />
  );
}
