import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/** 카드 그림자(Figma 4700:2747 drop 0,8,24 · 12%) — 형제 다이얼로그들과 같은 값, 파일마다 두는 관례. */
const DIALOG_SHADOW = {
  shadowColor: 'black',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
  elevation: 8,
} as const;

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
    <View
      testID="trip-base-regen-dialog"
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View
        testID="trip-base-regen-card"
        style={DIALOG_SHADOW}
        className="w-[330px] rounded-[20px] bg-canvas p-2xl"
      >
        <Text className="text-[19px] font-noto-bold text-ink">
          일정도 다시 만들까요?
        </Text>
        <Text className="mt-[10px] font-noto text-body leading-[21px] text-body">
          거점 숙소가 바뀌었어요. 일정은 그대로 둘 수 있어요. 다시 만들면 직접
          고친 내용은 사라질 수 있어요.
        </Text>

        <View className="mt-xl flex-row gap-[10px]">
          <Pressable
            testID="trip-base-regen-confirm"
            accessibilityRole="button"
            onPress={onRegenerate}
            className="h-[44px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-card-title text-body">
              일정 다시 만들기
            </Text>
          </Pressable>
          <Pressable
            testID="trip-base-regen-keep"
            accessibilityRole="button"
            onPress={onKeep}
            className="h-[44px] flex-1 items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-card-title text-on-primary">
              그대로 두기
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
