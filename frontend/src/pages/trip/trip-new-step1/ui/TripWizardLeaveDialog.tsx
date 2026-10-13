import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/** 카드 그림자 — `BaseRegenerateDialog` 와 같은 값, 파일마다 두는 관례(hex 가드 계열이라 `'black'`). */
const DIALOG_SHADOW = {
  shadowColor: 'black',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
  elevation: 8,
} as const;

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
    <View
      testID="trip-wizard-leave-dialog"
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View
        testID="trip-wizard-leave-card"
        style={DIALOG_SHADOW}
        className="w-[330px] rounded-[20px] bg-canvas p-2xl"
      >
        <Text className="text-[19px] font-noto-bold text-ink">
          여행 만들기를 그만둘까요?
        </Text>
        <Text className="mt-[10px] font-noto text-body leading-[21px] text-body">
          저장하면 내 여행에 작성 중으로 남아요. 삭제하면 되돌릴 수 없어요.
        </Text>
        {failed ? (
          <Text
            testID="trip-wizard-leave-error"
            className="mt-sm font-noto text-label text-primary-text"
          >
            삭제하지 못했어요. 다시 시도해 주세요.
          </Text>
        ) : null}

        <View className="mt-xl gap-[10px]">
          <Pressable
            testID="trip-wizard-leave-save"
            accessibilityRole="button"
            onPress={onSave}
            className="h-[44px] w-full items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-card-title text-on-primary">
              저장하고 나가기
            </Text>
          </Pressable>
          <Pressable
            testID="trip-wizard-leave-delete"
            accessibilityRole="button"
            onPress={onDelete}
            className="h-[44px] w-full items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-card-title text-body">
              삭제하고 나가기
            </Text>
          </Pressable>
          <Pressable
            testID="trip-wizard-leave-stay"
            accessibilityRole="button"
            onPress={onStay}
            className="items-center justify-center py-[10px]"
          >
            <Text className="text-[13.5px] font-noto-bold font-bold text-muted">
              계속 작성
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
