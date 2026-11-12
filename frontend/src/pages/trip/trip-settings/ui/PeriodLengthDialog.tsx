import { type ReactElement } from 'react';
import { Text } from 'react-native';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

/**
 * TRIP-1788 · 일수 변경 확인창 — 같은 여행에서 일정만 다시 짠다는 걸 확정 전에 알린다. `ConfirmDialog` 래퍼(Figma 프레임 없음 —
 * 기존 어휘). 요청·잠금·실패 판정은 페이지가 쥐고, 이 뷰는 콜백과 `failed` 만 받는다(`failed` 면 창을 안 닫고 안에 오류 문구).
 * 조건부 렌더 `absolute` 오버레이라 딤·중앙 정렬·터치 차단은 jest 사각(6-b 실기).
 */
export function PeriodLengthDialog({
  hasItinerary,
  droppedNotice,
  failed,
  onCancel,
  onConfirm,
}: {
  /** 지울 일정이 있나(`itineraryDayCount > 0`) — 없는 일정이 사라진다고 말하지 않는다. */
  hasItinerary: boolean;
  /** 일수를 줄여 빠지는 여행지 한 줄(`droppedNotice`). 없으면 줄 자체가 없다. */
  droppedNotice?: string | null;
  failed: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <ConfirmDialog
      testID="trip-settings-length-dialog"
      title="일수가 바뀌면 일정을 다시 짜야 해요"
      titleTestID="trip-settings-length-title"
      descriptionTestID="trip-settings-length-body"
      description={
        hasItinerary
          ? '지금 일정은 사라지고 이 여행에서 새로 짜요.'
          : '이 여행에서 일정을 새로 짜요.'
      }
      hangulBreak
      errorText={
        failed ? '다시 만들지 못했어요. 다시 시도해 주세요.' : undefined
      }
      errorTestID="trip-settings-length-error"
      buttons={[
        {
          testID: 'trip-settings-length-cancel',
          label: '취소',
          tone: 'outline',
          onPress: onCancel,
        },
        {
          testID: 'trip-settings-length-confirm',
          label: '다시 만들기',
          tone: 'primary',
          onPress: onConfirm,
        },
      ]}
    >
      {droppedNotice ? (
        <Text
          testID="trip-settings-length-dropped"
          className="mt-sm font-noto text-label text-ink"
        >
          {droppedNotice}
        </Text>
      ) : null}
    </ConfirmDialog>
  );
}
