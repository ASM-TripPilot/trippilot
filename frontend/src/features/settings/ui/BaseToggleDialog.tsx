import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/** 카드 그림자(Figma 1606:2440 drop 0,8,24 · 12%) — 형제 다이얼로그들과 같은 값, 파일마다 두는 관례. */
const DIALOG_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
  elevation: 8,
} as const;

/**
 * TRIP-605 · l04 **출발점 전환 재확인 다이얼로그**(BR-U6-21). 출발점을 바꾸면 조용히 재생성하지 않고
 * 먼저 묻는다 — [일정 다시 생성]을 눌러야 `onConfirm` 이 나간다(그 콜백이 페이지에서 DELETE/POST 로
 * 배선되므로, 이 다이얼로그를 거치지 않으면 서버 호출이 나가지 않는다).
 *
 * `RevokeConfirmDialog`(608·609) 와 동형으로 리포 Modal 선례 없이 **조건부 렌더 absolute 오버레이**로
 * 짜, 열림 시 testID 가 트리에 실재하게 한다(딤 실제 덮임·중앙 정렬은 jest 원리적 사각 — 6-b 실기 전용,
 * repo-traps 바텀시트 함정 동형).
 */
export function BaseToggleDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <View
      testID="my-stays-base-dialog"
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View
        style={DIALOG_SHADOW}
        className="w-[330px] rounded-[20px] bg-canvas p-2xl"
      >
        <Text className="text-[19px] font-noto-bold text-ink">
          출발점을 바꿀까요?
        </Text>
        <Text className="mt-[10px] font-noto text-body leading-[21px] text-body">
          이 여행의 일정을 처음부터 다시 생성합니다. 기존에 직접 편집한 내용은
          사라질 수 있어요.
        </Text>

        <View className="mt-xl flex-row gap-[10px]">
          <Pressable
            testID="my-stays-base-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="h-[44px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-card-title text-body">
              취소
            </Text>
          </Pressable>
          <Pressable
            testID="my-stays-base-confirm"
            accessibilityRole="button"
            onPress={onConfirm}
            className="h-[44px] flex-1 items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-card-title text-on-primary">
              일정 다시 생성
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
