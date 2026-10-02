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
 * TRIP-1055 · h06 작성중 여행 삭제 확인(Figma 4682:3206). 확정 전에는 아무것도 지우지 않는다(US-TRIP-10) —
 * 이 뷰는 콜백만 올리고, 요청·잠금·실패 판정은 페이지(`MyTripsListPage`)가 쥔다. `failed` 면 다이얼로그를
 * 닫지 않고 안에 실패 문구를 띄운다(01b Q4 · INV-4).
 *
 * `CoPickLeaveDialog` 와 같은 **조건부 렌더 absolute 오버레이** — 딤 실제 덮임·중앙 정렬·터치 차단은 jest
 * 원리적 사각(6-b 실기 전용, repo-traps). 프리뷰가 네트워크 계층을 전이 로드하지 않게 `@/shared/api` 를 물지
 * 않는다.
 */
export function TripDeleteDialog({
  failed,
  onCancel,
  onConfirm,
}: {
  failed: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <View
      testID="my-trip-delete-dialog"
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View
        testID="my-trip-delete-dialog-card"
        style={DIALOG_SHADOW}
        className="w-[330px] rounded-[20px] bg-canvas p-2xl"
      >
        <Text className="font-noto-bold text-[19px] text-ink">
          이 여행을 삭제할까요?
        </Text>
        {/* Figma 는 '지워지고' 뒤 강제 줄바꿈이지만 본문은 한 문자열 계약(완전 일치) — 어절 단위 줄바꿈으로
            '요.' 한 글자 고아 줄만 막는다. */}
        <Text
          lineBreakStrategyIOS="hangul-word"
          className="mt-sm font-noto text-body text-body"
        >
          작성 중인 일정도 함께 지워지고 되돌릴 수 없어요.
        </Text>
        {failed ? (
          <Text
            testID="my-trip-delete-error"
            className="mt-sm font-noto text-label text-primary-text"
          >
            삭제하지 못했어요. 다시 시도해 주세요.
          </Text>
        ) : null}

        <View className="mt-xl flex-row gap-[10px]">
          <Pressable
            testID="my-trip-delete-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="h-[52px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-[16px] text-ink">취소</Text>
          </Pressable>
          <Pressable
            testID="my-trip-delete-confirm"
            accessibilityRole="button"
            onPress={onConfirm}
            className="h-[52px] flex-1 items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-[16px] text-canvas">삭제</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
