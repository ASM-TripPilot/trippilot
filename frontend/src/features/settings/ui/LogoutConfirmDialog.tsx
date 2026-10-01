import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * TRIP-938 · 로그아웃 확인 다이얼로그(1단). `BaseToggleDialog`·`RevokeConfirmDialog` 와 동형으로 리포 Modal
 * 선례 없이 **조건부 렌더 absolute 오버레이**다 — 열림 시 testID 가 트리에 실재한다(딤 실제 덮임·중앙
 * 정렬은 jest 원리적 사각, 6-b 실기 전용 · repo-traps). [로그아웃]을 눌러야 `onConfirm` 이 나간다.
 */
export function LogoutConfirmDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <View
      testID="logout-confirm"
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View className="w-[330px] rounded-[20px] bg-canvas p-2xl">
        <Text className="text-[19px] font-noto-bold text-ink">
          로그아웃할까요?
        </Text>

        <View className="mt-2xl flex-row gap-[10px]">
          <Pressable
            testID="logout-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="h-12 flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-card-title text-ink">
              취소
            </Text>
          </Pressable>
          <Pressable
            testID="logout-confirm-button"
            accessibilityRole="button"
            onPress={onConfirm}
            className="h-12 flex-1 items-center justify-center rounded-button bg-ink"
          >
            <Text className="font-noto-bold text-card-title text-canvas">
              로그아웃
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
