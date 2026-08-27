import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApplyReplan } from '@/features/planb/model/useApplyReplan';
import { useCancelReplan } from '@/features/planb/model/useCancelReplan';
import { AppliedAlertGlyph } from '@/features/planb/ui/PlanbGlyphs';
import { ReplanAppliedScreen } from '@/features/planb/ui/ReplanAppliedScreen';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-441 · AC-1·2·3·4 — planb-diff 배선(확정·취소·성공전이·실패·pending 을 잇는 유일한 자리).
 *
 * 세 얼굴을 조건부로 그린다:
 *  - apply 성공 → i19 `ReplanAppliedScreen`([여행 계속하기]→live).
 *  - apply·cancel 실패 → 공용 `StateNotice`(error) — "원래 일정은 그대로"를 정직하게 알리고
 *    [다시 시도]로 회복 가능(BR-U4-32 부분 반영 금지 · INV-4 침묵 금지).
 *  - 그 외(pre-apply) → 정직한 한 줄 안내 + [확정]/[취소]. 지표·전후 배지는 draft 부재로 이번에
 *    안 그린다(01 §5).
 *
 * 확정은 **반드시 seam(useApplyReplan)** 경유 — codegen apply 훅 직접 호출은 구조가드 G4 가 봉인
 * (BR-U4-28). 취소도 이 페이지는 seam(useCancelReplan) 경유하나 **구조 강제는 apply 만** — cancel
 * codegen 훅엔 봉인 가드가 없다(형제 PlanbSolvingPage 는 그 훅을 직접 부른다). tripId·sessionId 는
 * `.mutate({tripId, sessionId})` 변수로 넘긴다. 한쪽이라도 pending 이면 두 버튼을 함께 `disabled` 로
 * 잠가(교차 잠금) 같은 세션에 apply·cancel 두 POST 가 동시 발사되는 경쟁을 막는다(중복·경쟁 쓰기 차단).
 */

export interface PlanbDiffPageProps {
  tripId: string;
  sessionId: string;
}

const CONFIRM_NOTE =
  '재계획한 일정을 지금 일정에 반영할까요? 확정하면 새 일정으로 바뀌어요.';
const ERROR_NOTE = '원래 일정은 그대로 있어요. 잠시 후 다시 시도해 주세요.';

export function PlanbDiffPage({
  tripId,
  sessionId,
}: PlanbDiffPageProps): ReactElement {
  const router = useRouter();
  const applyMutation = useApplyReplan();
  const cancelMutation = useCancelReplan();

  const vars = { tripId, sessionId };
  const goToLive = () => router.push(`/trips/${tripId}/live`);

  // 확정 성공 → i19. 세션이 반영돼 되돌아갈 diff 가 없으므로 뒤로·계속하기 둘 다 live 로 나간다.
  if (applyMutation.isSuccess) {
    return <ReplanAppliedScreen onBack={goToLive} onContinue={goToLive} />;
  }

  // 확정·취소 실패 → 공용 오류 표면. i19 로 넘어가지 않는다(부분 반영 금지).
  // [다시 시도]는 **실패한 mutation 에 맞춰 분기**한다 — apply 실패면 apply 재발화, 아니면(cancel
  // 실패면) cancel 재발화(성공 시 live 복귀 콜백 유지). 항상 apply 를 부르면 폐기하려던 사용자가
  // 재시도 시 반대로 일정을 쓰게 된다(경고-1 봉합).
  if (applyMutation.isError || cancelMutation.isError) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 bg-canvas px-lg pt-lg">
          <StateNotice
            testID="planb-diff-error"
            icon={<AppliedAlertGlyph size={32} />}
            title="변경을 반영하지 못했어요"
            description={ERROR_NOTE}
            actions={[
              {
                testID: 'planb-diff-retry',
                label: '다시 시도',
                variant: 'filled',
                onPress: () =>
                  applyMutation.isError
                    ? applyMutation.mutate(vars)
                    : cancelMutation.mutate(vars, { onSuccess: goToLive }),
              },
            ]}
          />
        </View>
      </SafeAreaView>
    );
  }

  // pre-apply — 정직한 안내 + [확정]/[취소]. draft 부재로 지표·전후 배지는 없다.
  // 한쪽이라도 pending 이면 두 버튼 다 잠근다(교차 잠금) — 같은 세션에 apply·cancel 두 POST 가
  // 동시 발사되는 경쟁을 막는다(경고-2 봉합). 자기 버튼 자기잠금은 그대로 성립(I7·I8 유지).
  const busy = applyMutation.isPending || cancelMutation.isPending;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 gap-lg bg-canvas px-lg pt-lg">
        <View className="gap-sm">
          <Text className="font-noto-bold text-hero font-bold text-ink">
            변경 확정
          </Text>
          <Text className="font-noto text-label text-muted">
            {CONFIRM_NOTE}
          </Text>
        </View>

        <View className="gap-sm pt-sm">
          <Pressable
            testID="planb-diff-confirm"
            accessibilityRole="button"
            disabled={busy}
            onPress={() => applyMutation.mutate(vars)}
            className={`items-center justify-center rounded-button py-[15px] ${
              busy ? 'bg-surface-strong' : 'bg-primary'
            }`}
          >
            <Text
              className={`font-noto-bold text-[16px] font-bold ${
                busy ? 'text-muted' : 'text-on-primary'
              }`}
            >
              확정
            </Text>
          </Pressable>

          <Pressable
            testID="planb-diff-cancel"
            accessibilityRole="button"
            disabled={busy}
            onPress={() => cancelMutation.mutate(vars, { onSuccess: goToLive })}
            className={`items-center justify-center rounded-button border border-hairline-strong py-[15px] ${
              busy ? 'bg-surface-strong' : 'bg-canvas'
            }`}
          >
            <Text
              className={`font-noto-bold text-[16px] font-bold ${
                busy ? 'text-muted' : 'text-ink'
              }`}
            >
              취소
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
