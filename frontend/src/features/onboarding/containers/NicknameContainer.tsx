/**
 * 닉네임 설정 배선 (US-ONB-03 · AC B1·B2·B5~B9).
 * useNickname 상태 → NicknameScreen props, 저장 성공 → 게이트('/') 복귀로 부트스트랩 재판정.
 */
import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { useNickname } from '../hooks/useNickname';
import { NicknameScreen } from '../screens/NicknameScreen';

export function NicknameContainer(): ReactElement {
  const router = useRouter();
  const {
    value,
    canProceed,
    errorReason,
    suggestions,
    change,
    regenerate,
    selectSuggestion,
    submit,
  } = useNickname();

  // 저장·완료가 모두 성공하면 게이트('/')로 복귀한다(D3). 실패면 오류만 남고 머문다(INV-4).
  const handleNext = () => {
    void (async () => {
      const done = await submit();
      if (done) {
        router.replace('/');
      }
    })();
  };

  return (
    <NicknameScreen
      value={value}
      canProceed={canProceed}
      errorReason={errorReason}
      suggestions={suggestions}
      onChange={change}
      onRegenerate={regenerate}
      onSelectSuggestion={selectSuggestion}
      onNext={handleNext}
    />
  );
}
