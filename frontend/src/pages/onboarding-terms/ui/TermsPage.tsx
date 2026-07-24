/**
 * 약관 동의 배선 (US-ONB-02 · AC A3~A8 · C4).
 * useTermsConsent 상태 → TermsScreen props, 콜백 → 훅, 저장 성공 → 닉네임 단계 라우팅.
 */
import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { useTermsConsent } from '@/features/onboarding/model/useTermsConsent';
import { TermsScreen } from '@/features/onboarding/ui/TermsScreen';

export function TermsPage(): ReactElement {
  const router = useRouter();
  const {
    items,
    allChecked,
    canProceed,
    missingRequiredLabels,
    errorMessage,
    toggle,
    toggleAll,
    submit,
  } = useTermsConsent();

  // 저장이 성공했을 때만 다음 단계로 넘어간다(A8 · INV-4). 실패면 오류만 남기고 머문다.
  const handleNext = () => {
    void (async () => {
      const saved = await submit();
      if (saved) {
        router.replace('/(onboarding)/nickname');
      }
    })();
  };

  return (
    <TermsScreen
      items={items}
      allChecked={allChecked}
      canProceed={canProceed}
      missingRequiredLabels={missingRequiredLabels}
      errorMessage={errorMessage}
      onToggle={toggle}
      onToggleAll={toggleAll}
      onNext={handleNext}
      onRetry={handleNext}
    />
  );
}
