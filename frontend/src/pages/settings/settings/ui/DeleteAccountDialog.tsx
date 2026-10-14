import { type ReactElement, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';

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
  initialStep = 'confirm1',
}: {
  onCancel: () => void;
  onConfirmDeletion: () => void;
  /** `_dev/preview` 전용(2단 얼굴 키). 프로덕션은 넘기지 않는다 — eslint `no-restricted-syntax`(`DELETE_DIALOG_GATE`: .tsx 태그 prop·펼치기 + 별칭 import·재수출은 .ts 에서도 `DELETE_DIALOG_ALIAS_GATE` 로)가 막는다. 사각 — 린트가 **전부** 막는 것은 아니다(일부러 우회해야 하는 모양이라 남김): createElement · 네임스페이스 태그(`<S.DeleteAccountDialog>`) · default export 후 다른 이름으로 import · `export const Safe = DeleteAccountDialog` · 같은 파일 안 재바인딩 · .js/.jsx/.mjs(게이트 밖, 지금 src·app 에 0개). */
  initialStep?: 'confirm1' | 'confirm2';
}): ReactElement {
  const [step, setStep] = useState<'confirm1' | 'confirm2'>(initialStep);

  if (step === 'confirm1') {
    return (
      <ConfirmDialog
        title="계정을 삭제할까요?"
        description="아래 항목이 계정과 함께 모두 삭제됩니다."
        buttons={[
          {
            testID: 'settings-delete-cancel',
            label: '취소',
            tone: 'outline',
            onPress: onCancel,
          },
          {
            testID: 'settings-delete-confirm',
            label: '계속',
            tone: 'ink',
            onPress: () => setStep('confirm2'),
          },
        ]}
      >
        {/* 상한 248 = 9행 228(20×9 + 간격 6×8) + 최장 항목 줄바꿈 한 줄 여유 — 잘림 없이, 큰 글자에선 스크롤. */}
        <ScrollView className="mt-md max-h-[248px]">
          <View className="gap-[6px]">
            {DELETION_SCOPE.map((item) => (
              <View key={item} className="flex-row gap-sm">
                <Text className="font-noto text-body text-ink">•</Text>
                <Text className="flex-1 font-noto text-body text-ink">
                  {item}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </ConfirmDialog>
    );
  }
  return (
    <ConfirmDialog
      title="정말 삭제할까요?"
      description="확인하면 계정과 위의 모든 데이터가 삭제 절차에 들어가고, 30일 뒤 완전히 삭제돼요. 그 전에는 설정에서 삭제를 취소할 수 있어요."
      buttons={[
        {
          testID: 'settings-delete-cancel',
          label: '취소',
          tone: 'outline',
          onPress: onCancel,
        },
        {
          testID: 'settings-delete-confirm-final',
          label: '계정 삭제',
          tone: 'primary',
          onPress: onConfirmDeletion,
        },
      ]}
    />
  );
}
