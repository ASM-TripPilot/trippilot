import { type ReactElement, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { DELETION_SCOPE } from '../model/deletionScope';

/**
 * 계정 삭제 **2단 순차 다이얼로그**(Q2 · AC-12 법적 게이트). 리포에 Modal 선례가 0이라 신설 —
 * RN `Modal` 대신 **조건부 렌더 absolute 오버레이**로 짜서 열림 시 testID 가 트리에 실재하게 한다
 * (jest 가 딤의 실제 덮임·모달 실제 열림은 원리적으로 못 본다 — 그 축은 6-b 실기 전용, repo-traps).
 *
 * 로컬 `step` 상태가 게이트의 핵심이다: `onConfirmDeletion`(2단 최종, 페이지가 POST 로 배선)은
 * **step2 에서만** 불린다. 1단 [계속]은 step2 로 전이할 뿐 콜백을 안 부른다 — 이 구조가 "1단만으로
 * POST 가 나가면 위반"을 기계로 막는다(AC-12: mutate 스파이로 "1단 후 미호출·2단 후 1회" 잠금).
 *
 * 1단은 `DELETION_SCOPE` **전체 목록을 렌더**한다(Q1 — Figma 3항목 축약 산문 미채용, 법적 고지는
 * 더 많이 고지하는 쪽). 목록 리터럴은 `deletionScope.ts` 에만 살고 여기선 map 한다.
 */
export function DeleteAccountDialog({
  onCancel,
  onConfirmDeletion,
}: {
  onCancel: () => void;
  onConfirmDeletion: () => void;
}): ReactElement {
  const [step, setStep] = useState<'confirm1' | 'confirm2'>('confirm1');

  return (
    <View className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl">
      <View className="w-[330px] rounded-[20px] bg-canvas p-2xl">
        {step === 'confirm1' ? (
          <>
            <Text className="text-[19px] font-noto-bold text-ink">
              계정을 삭제할까요?
            </Text>
            <Text className="mt-sm font-noto text-body text-body">
              아래 항목이 계정과 함께 모두 삭제되며 되돌릴 수 없습니다.
            </Text>
            <ScrollView className="mt-md max-h-[220px]">
              <View className="gap-xs">
                {DELETION_SCOPE.map((item) => (
                  <View key={item} className="flex-row gap-sm">
                    <Text className="font-noto text-body text-muted">·</Text>
                    <Text className="flex-1 font-noto text-body text-body">
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            <View className="mt-2xl flex-row gap-[10px]">
              <DialogButton
                testID="settings-delete-cancel"
                label="취소"
                tone="ghost"
                onPress={onCancel}
              />
              <DialogButton
                testID="settings-delete-confirm"
                label="계속"
                tone="dark"
                onPress={() => setStep('confirm2')}
              />
            </View>
          </>
        ) : (
          <>
            <Text className="text-[19px] font-noto-bold text-ink">
              정말 삭제할까요?
            </Text>
            <Text className="mt-sm font-noto text-body text-body">
              이 작업은 되돌릴 수 없어요. 확인하면 계정과 위의 모든 데이터가
              삭제 절차에 들어갑니다.
            </Text>
            <View className="mt-2xl flex-row gap-[10px]">
              <DialogButton
                testID="settings-delete-cancel"
                label="취소"
                tone="ghost"
                onPress={onCancel}
              />
              <DialogButton
                testID="settings-delete-confirm-final"
                label="계정 삭제"
                tone="danger"
                onPress={onConfirmDeletion}
              />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function DialogButton({
  testID,
  label,
  tone,
  onPress,
}: {
  testID: string;
  label: string;
  tone: 'ghost' | 'dark' | 'danger';
  onPress: () => void;
}): ReactElement {
  const surface =
    tone === 'ghost'
      ? 'border border-hairline-strong bg-canvas'
      : tone === 'danger'
        ? 'bg-primary'
        : 'bg-ink';
  const text = tone === 'ghost' ? 'text-ink' : 'text-canvas';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className={`h-12 flex-1 items-center justify-center rounded-button ${surface}`}
    >
      <Text className={`font-noto-bold text-card-title ${text}`}>{label}</Text>
    </Pressable>
  );
}
