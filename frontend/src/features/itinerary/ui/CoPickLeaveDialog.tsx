import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/** 카드 그림자(Figma l05 dialog drop 0,8,24 · 12%) — 형제 다이얼로그들과 같은 값, 파일마다 두는 관례. */
const DIALOG_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
  elevation: 8,
} as const;

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
    <View
      testID="itinerary-copick-leave-confirm"
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View
        style={DIALOG_SHADOW}
        className="w-[330px] rounded-[20px] bg-canvas p-2xl"
      >
        <Text className="text-[19px] font-noto-bold text-ink">
          같이 짜기를 멈출까요?
        </Text>
        <Text className="mt-[10px] font-noto text-body leading-[21px] text-body">
          {`고른 ${pickedCount}곳은 저장돼 있어요. 나머지는 AI가 고른 그대로 남아요.`}
        </Text>

        <View className="mt-xl flex-row gap-[10px]">
          <Pressable
            testID="itinerary-copick-leave-confirm-stay"
            accessibilityRole="button"
            onPress={onStay}
            className="h-[44px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-card-title text-body">
              머무르기
            </Text>
          </Pressable>
          <Pressable
            testID="itinerary-copick-leave-confirm-leave"
            accessibilityRole="button"
            onPress={onLeave}
            className="h-[44px] flex-1 items-center justify-center rounded-button bg-ink"
          >
            <Text className="font-noto-bold text-card-title text-canvas">
              나가기
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
