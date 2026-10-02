import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/** 카드 그림자(Figma 4682:3206 drop 0,8,24 · 12%) — 형제 다이얼로그들과 같은 값, 파일마다 두는 관례. */
const DIALOG_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
  elevation: 8,
} as const;

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
    <View
      testID="itinerary-edit-save-conflict"
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View
        testID="itinerary-edit-save-conflict-card"
        style={DIALOG_SHADOW}
        className="w-[330px] rounded-[20px] bg-canvas p-2xl"
      >
        <Text className="font-noto-bold text-[19px] text-ink">
          {`${count}곳에서 시간이 안 맞아요`}
        </Text>

        <View className="mt-xl flex-row gap-[10px]">
          <Pressable
            testID="itinerary-edit-save-back"
            accessibilityRole="button"
            onPress={onBack}
            className="h-[52px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-[16px] text-ink">고치기</Text>
          </Pressable>
          <Pressable
            testID="itinerary-edit-save-asis"
            accessibilityRole="button"
            onPress={onConfirm}
            className="h-[52px] flex-1 items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-[16px] text-canvas">
              {confirmLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
