/**
 * 닉네임 설정 배선 (US-ONB-03 · AC B1·B2·B5~B9).
 * useNickname 상태 → NicknameScreen props, 저장 성공 → 게이트('/') 복귀로 부트스트랩 재판정.
 */
import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { useNickname } from '@/features/onboarding/model/useNickname';
import { NicknameScreen } from '@/features/onboarding/ui/NicknameScreen';

export function NicknamePage(): ReactElement {
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

  // 저장·완료가 모두 성공하면 위치 프리프롬프트(c08)로 넘어간다(TRIP-459 — pref1 앞에 c08 삽입).
  // 실패면 오류만 남고 머문다(INV-4).
  const handleNext = () => {
    void (async () => {
      const done = await submit();
      if (done) {
        router.replace('/(onboarding)/location');
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
