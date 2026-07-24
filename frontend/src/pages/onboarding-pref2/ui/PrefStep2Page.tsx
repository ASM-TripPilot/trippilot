/**
 * 취향 2/2 배선 (TRIP-163 · AC2 · AC3 · AC4) — 스토어 ↔ 화면 ↔ 라우터.
 * 스토어가 모듈 싱글턴이라 1/2↔2/2 왕복(back)에도 선택값이 그대로 남는다(§1 개념 박스).
 */
import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { usePreferenceStore } from '@/features/onboarding/model/preferenceStore';
import { PrefStep2Screen } from '@/features/onboarding/ui/PrefStep2Screen';

export function PrefStep2Page(): ReactElement {
  const router = useRouter();
  const budget = usePreferenceStore((state) => state.budget);
  const companions = usePreferenceStore((state) => state.companions);
  const foods = usePreferenceStore((state) => state.foods);
  const transports = usePreferenceStore((state) => state.transports);
  const toggleBudget = usePreferenceStore((state) => state.toggleBudget);
  const toggleCompanion = usePreferenceStore((state) => state.toggleCompanion);
  const toggleFood = usePreferenceStore((state) => state.toggleFood);
  const toggleTransport = usePreferenceStore((state) => state.toggleTransport);

  // 2/2 전용 back(Q4) — 1/2가 push로 쌓아 둔 스택으로 되돌아간다. 스토어는 그대로 살아있다.
  const handleBack = () => {
    router.back();
  };

  // '완료' — 0개 선택에도 항상 진행(인터뷰4). 저장 배선이 없어 닉네임과 같은 게이트
  // 복귀 패턴(replace('/') → 부트스트랩 재판정)을 그대로 쓴다(인터뷰1/Q6).
  const handleDone = () => {
    router.replace('/');
  };

  // 상·하단 '나중에 설정하고 시작' — 남은 선택은 그대로 두고(01b: 폐기 안 함) 홈으로.
  const handleSkipAll = () => {
    router.replace('/');
  };

  return (
    <PrefStep2Screen
      selectedBudget={budget}
      selectedCompanions={companions}
      selectedFoods={foods}
      selectedTransports={transports}
      onToggleBudget={toggleBudget}
      onToggleCompanion={toggleCompanion}
      onToggleFood={toggleFood}
      onToggleTransport={toggleTransport}
      onBack={handleBack}
      onDone={handleDone}
      onSkipAll={handleSkipAll}
    />
  );
}
