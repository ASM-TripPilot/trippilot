import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/** 카드 그림자 — 형제 다이얼로그들(`SaveConflictDialog`·`TripDeleteDialog`)과 같은 값, 파일마다 두는 관례. */
const DIALOG_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
  elevation: 8,
} as const;

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
    <View
      testID="mustvisit-pick-outside-confirm"
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View
        testID="mustvisit-pick-outside-confirm-card"
        style={DIALOG_SHADOW}
        className="w-[330px] rounded-[20px] bg-canvas p-2xl"
      >
        <Text className="font-noto-bold text-[19px] text-ink">
          {`이 여행 지역 밖 ${count}곳이 함께 들어가요`}
        </Text>

        <View className="mt-xl flex-row gap-[10px]">
          <Pressable
            testID="mustvisit-pick-outside-exclude"
            accessibilityRole="button"
            onPress={onExclude}
            className="h-[52px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-[16px] text-ink">
              빼고 완료
            </Text>
          </Pressable>
          <Pressable
            testID="mustvisit-pick-outside-keep"
            accessibilityRole="button"
            onPress={onKeep}
            className="h-[52px] flex-1 items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-[16px] text-canvas">
              그대로 넣기
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
