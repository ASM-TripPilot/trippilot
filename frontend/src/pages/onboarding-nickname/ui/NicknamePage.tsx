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

  // 저장·완료가 모두 성공하면 취향 1/2로 넘어간다(TRIP-163 인터뷰1 — '/'였던 목적지를
  // 취향 온보딩으로 교체). 실패면 오류만 남고 머문다(INV-4).
  const handleNext = () => {
    void (async () => {
      const done = await submit();
      if (done) {
        router.replace('/(onboarding)/pref1');
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
