import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/** 카드 그림자(drop 0,8,24 · 12%) — 형제 다이얼로그들과 같은 값, 파일마다 두는 관례. */
const DIALOG_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
  elevation: 8,
} as const;

/**
 * TRIP-1069 · j01 건너뛰기 확인(결정 3(c)). 건너뛴 방문은 되돌릴 수 없고 완료로 바꿀 수 없다(BR-U5-06) —
 * 확정 전에는 아무 요청도 없다. 이 뷰는 콜백만 올리고 요청·실패 판정은 페이지가 쥔다. `failed` 면 닫지 않고
 * 안에 실패 문구를 띄운다(INV-4). `pending`(확정 뒤 응답 전)엔 두 버튼을 막는다 — 취소했다고 믿었는데 건너뛰어지는
 * 일, 늦은 결과가 다른 카드의 다이얼로그를 덮는 일을 막는다(03b W1).
 *
 * Figma 프레임이 없어 `TripDeleteDialog`(features/itinerary) 토큰을 복제했다 — features 간 import 금지.
 * 조건부 렌더 absolute 오버레이라 딤 덮임·중앙 정렬·터치 차단은 jest 원리적 사각(6-b 실기, repo-traps).
 */
export function SkipVisitDialog({
  pending,
  failed,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  failed: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <View
      testID="record-visit-skip-dialog"
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View
        style={DIALOG_SHADOW}
        className="w-[330px] rounded-[20px] bg-canvas p-2xl"
      >
        <Text className="font-noto-bold text-[19px] text-ink">
          이 방문을 건너뛸까요?
        </Text>
        <Text
          lineBreakStrategyIOS="hangul-word"
          className="mt-sm font-noto text-body text-body"
        >
          건너뛴 곳은 되돌리거나 완료로 바꿀 수 없어요.
        </Text>
        {failed ? (
          <Text
            testID="record-visit-skip-dialog-error"
            className="mt-sm font-noto text-label text-primary-text"
          >
            건너뛰지 못했어요. 다시 시도해 주세요.
          </Text>
        ) : null}

        <View className="mt-xl flex-row gap-[10px]">
          <Pressable
            testID="record-visit-skip-dialog-cancel"
            accessibilityRole="button"
            disabled={pending}
            onPress={onCancel}
            className="h-[52px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-[16px] text-ink">취소</Text>
          </Pressable>
          <Pressable
            testID="record-visit-skip-dialog-confirm"
            accessibilityRole="button"
            disabled={pending}
            onPress={onConfirm}
            className="h-[52px] flex-1 items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-[16px] text-canvas">
              건너뛰기
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
