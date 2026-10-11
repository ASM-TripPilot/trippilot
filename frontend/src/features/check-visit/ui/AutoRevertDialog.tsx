import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/** 카드 그림자 — 형제 확인 다이얼로그들과 같은 값(파일마다 두는 관례). */
const DIALOG_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
  elevation: 8,
} as const;

export type AutoRevertPart = 'COMPLETION' | 'ARRIVAL';
export type AutoRevertError = 'media' | 'failed' | null;

/**
 * TRIP-1340 · 자동 기록 되돌리기 확인(BR-U10-31 · Figma u10b 4860:3577). 확정 전에는 아무것도 바꾸지 않는다 —
 * 콜백만 올리고 요청·잠금·실패 판정은 페이지가 쥔다. 완료를 되돌리면 재계획 잠금도 풀린다는 고지 1줄.
 * 사진·메모가 붙은 방문의 도착 되돌리기는 서버 409 → `error='media'` 안내(기록을 조용히 잃지 않는다).
 * i01·j01 공용(testID 접두만 다르다). 조건부 렌더 absolute 오버레이 — 덮임·중앙 정렬은 jest 사각(6-b).
 */
export function AutoRevertDialog({
  testIDPrefix,
  placeName,
  part,
  pending = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  /** 예: `execution-live-slot-auto-revert` → `-confirm`·`-cancel`·`-media-notice`. */
  testIDPrefix: string;
  placeName: string;
  part: AutoRevertPart;
  pending?: boolean;
  error?: AutoRevertError;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  const body =
    part === 'COMPLETION'
      ? `자동으로 남긴 '방문 완료'를 지워요. ${placeName}은(는) 다시 '방문 중'이 되고, 재계획에서 이 장소를 바꿀 수 있게 돼요.`
      : `자동으로 남긴 도착 기록을 지워요. ${placeName}은(는) 오늘 자동 기록에서 빠지고, 직접 [도착]으로 남길 수 있어요.`;
  return (
    <View
      testID={`${testIDPrefix}-dialog`}
      className="absolute inset-0 items-center justify-center bg-scrim/40 px-2xl"
    >
      <View
        style={DIALOG_SHADOW}
        className="w-[330px] rounded-[20px] bg-canvas p-2xl"
      >
        <Text className="font-noto-bold text-[19px] text-ink">
          자동 기록을 되돌릴까요?
        </Text>
        <Text
          lineBreakStrategyIOS="hangul-word"
          className="mt-sm font-noto text-body text-body"
        >
          {body}
        </Text>
        {error === 'media' ? (
          <Text
            testID={`${testIDPrefix}-media-notice`}
            className="mt-sm font-noto text-label text-primary-text"
          >
            사진·메모가 있는 방문은 되돌릴 수 없어요. 먼저 사진·메모를 지워
            주세요.
          </Text>
        ) : null}
        {error === 'failed' ? (
          <Text
            testID={`${testIDPrefix}-error`}
            className="mt-sm font-noto text-label text-primary-text"
          >
            되돌리지 못했어요. 다시 시도해 주세요.
          </Text>
        ) : null}
        <View className="mt-xl flex-row gap-[10px]">
          <Pressable
            testID={`${testIDPrefix}-cancel`}
            accessibilityRole="button"
            onPress={onCancel}
            className="h-[52px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-[16px] text-ink">취소</Text>
          </Pressable>
          <Pressable
            testID={`${testIDPrefix}-confirm`}
            accessibilityRole="button"
            disabled={pending || error === 'media'}
            onPress={onConfirm}
            className={`h-[52px] flex-1 items-center justify-center rounded-button ${
              error === 'media' ? 'bg-hairline-strong' : 'bg-primary'
            }`}
          >
            <Text className="font-noto-bold text-[16px] text-canvas">
              되돌리기
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
