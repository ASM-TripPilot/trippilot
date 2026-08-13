/**
 * 취향 1/2 배선 (AC3 · AC4) — usePreferenceStore ↔ PrefStep1Screen ↔ expo-router.
 * 스타일·페이스 상태와 토글 액션을 셀렉터로 구독해 Screen에 내려주고, '다음'은 pref2로
 * push(back()이 1/2로 돌아오도록 replace가 아니다), skip은 스토어를 건드리지 않고
 * 홈으로 replace한다(US-ONB-11 — 미선택 축은 null로 유지).
 */
import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { usePreferenceStore } from '@/features/onboarding/model/preferenceStore';
import { notifyBootstrapReeval } from '@/shared/bootstrap/bootstrapReeval';
import { PrefStep1Screen } from '@/features/onboarding/ui/PrefStep1Screen';

export function PrefStep1Page(): ReactElement {
  const router = useRouter();

  // getState()가 아니라 셀렉터로 구독해야 카드를 탭했을 때 화면이 다시 그려진다.
  const selectedStyles = usePreferenceStore((state) => state.styles);
  const selectedPace = usePreferenceStore((state) => state.pace);
  const toggleStyle = usePreferenceStore((state) => state.toggleStyle);
  const togglePace = usePreferenceStore((state) => state.togglePace);

  const handleNext = () => {
    router.push('/(onboarding)/pref2');
  };

  const handleSkipAll = () => {
    // 취향 1/2 탈출도 완료로 취급해 재평가 신호를 발화한다(ticket AC-A · US-ONB-11 —
    // pref2 만 고치면 1/2 에서 탈출한 사용자가 결함 A 그대로 약관으로 갇힌다).
    // 스토어를 건드리지 않는다 — 미선택 축이 []가 아니라 null로 유지돼야 한다.
    notifyBootstrapReeval();
    router.replace('/');
  };

  return (
    <PrefStep1Screen
      selectedStyles={selectedStyles}
      selectedPace={selectedPace}
      onToggleStyle={toggleStyle}
      onTogglePace={togglePace}
      onNext={handleNext}
      onSkipAll={handleSkipAll}
    />
  );
}
