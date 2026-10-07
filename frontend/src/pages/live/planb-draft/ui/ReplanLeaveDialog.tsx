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
 * TRIP-1007 · i05 다시 짜는 중 이탈 확인(QA #062). 나가도 세션은 살아 있지만, 돌아와서 다시 요청하면 새
 * 요청이 이 세션을 닫아(INV-U4-06) 지금 짜는 결과가 버려진다 — 그 사실을 나가기 전에 말한다.
 * 문구는 정본·Figma 프레임이 없어 이 사이클이 정한 값이다(D4).
 *
 * `CoPickLeaveDialog`(features/itinerary)·settings 확인 다이얼로그와 같은 **조건부 렌더 absolute 오버레이**
 * 모양이다 — 그쪽은 문구·testID 가 박혀 있어 모양만 따른다. 딤 실제 덮임·셸 시트 위 z-order·터치 차단은
 * jest 원리적 사각(6-b 실기 전용, repo-traps).
 *
 * TRIP-1277 — i06 재계획안 이탈 확인도 이 다이얼로그를 쓴다. 문구·testID 만 props 로 열었고 기본값은 i05 값
 * 그대로다(복제를 늘리지 않는다). 버튼 testID 는 `${testID}-stay`·`${testID}-leave`.
 */
export interface ReplanLeaveDialogProps {
  onStay: () => void;
  onLeave: () => void;
  testID?: string;
  title?: string;
  description?: string;
  stayLabel?: string;
  leaveLabel?: string;
}

/** i06 재계획안 이탈 확인 문구(01b Q8) — 페이지와 프리뷰가 같은 값을 쓴다. */
export const DRAFT_LEAVE_COPY = {
  testID: 'planb-draft-leave-confirm',
  title: '재계획안을 적용하지 않고 나갈까요?',
  description: '나가면 이 재계획안은 다시 볼 수 없어요. 원래 일정은 그대로예요',
  stayLabel: '계속 보기',
} as const;

export function ReplanLeaveDialog({
  onStay,
  onLeave,
  testID = 'planb-solving-leave-confirm',
  title = '나가면 결과를 잃을 수 있어요',
  description = '다시 요청하면 지금 짜는 결과는 사라져요',
  stayLabel = '계속 기다리기',
  leaveLabel = '나가기',
}: ReplanLeaveDialogProps): ReactElement {
  return (
    <View
      testID={testID}
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View
        style={DIALOG_SHADOW}
        className="w-[330px] rounded-[20px] bg-canvas p-2xl"
      >
        <Text className="text-[19px] font-noto-bold text-ink">{title}</Text>
        <Text className="mt-[10px] font-noto text-body leading-[21px] text-body">
          {description}
        </Text>

        <View className="mt-xl flex-row gap-[10px]">
          <Pressable
            testID={`${testID}-stay`}
            accessibilityRole="button"
            onPress={onStay}
            className="h-[44px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-card-title text-body">
              {stayLabel}
            </Text>
          </Pressable>
          <Pressable
            testID={`${testID}-leave`}
            accessibilityRole="button"
            onPress={onLeave}
            className="h-[44px] flex-1 items-center justify-center rounded-button bg-ink"
          >
            <Text className="font-noto-bold text-card-title text-canvas">
              {leaveLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
