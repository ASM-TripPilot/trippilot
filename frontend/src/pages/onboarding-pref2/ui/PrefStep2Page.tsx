/**
 * 취향 2/2 배선 (AC2 · AC3 · AC4) — usePreferenceStore ↔ PrefStep2Screen ↔ expo-router.
 * 예산·동행·활동·음식·이동 5축 상태와 토글 액션을 셀렉터로 구독해 Screen에 내려주고, back은
 * router.back()으로 1/2로 복귀시키며, '완료'·일괄 탈출 모두 스토어를 건드리지 않고
 * 홈으로 replace한다(US-ONB-06/07/09/10 — 미선택 축은 null로 유지).
 */
import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { usePreferenceStore } from '@/features/onboarding/model/preferenceStore';
import { notifyBootstrapReeval } from '@/shared/bootstrap/bootstrapReeval';
import { PrefStep2Screen } from '@/features/onboarding/ui/PrefStep2Screen';

export function PrefStep2Page(): ReactElement {
  const router = useRouter();

  // getState()가 아니라 셀렉터로 구독해야 타일을 탭했을 때 화면이 다시 그려진다.
  const selectedBudget = usePreferenceStore((state) => state.budget);
  const selectedCompanions = usePreferenceStore((state) => state.companions);
  const selectedActivities = usePreferenceStore((state) => state.activities);
  const selectedFoods = usePreferenceStore((state) => state.foods);
  const selectedTransports = usePreferenceStore((state) => state.transports);
  const toggleBudget = usePreferenceStore((state) => state.toggleBudget);
  const toggleCompanion = usePreferenceStore((state) => state.toggleCompanion);
  const toggleActivity = usePreferenceStore((state) => state.toggleActivity);
  const toggleFood = usePreferenceStore((state) => state.toggleFood);
  const toggleTransport = usePreferenceStore((state) => state.toggleTransport);

  const handleBack = () => {
    router.back();
  };

  const handleDone = () => {
    // 온보딩 완료를 useBootstrapGate로 올려 재평가시킨다(라우터 관통 없는 pub/sub, 결함 A) —
    // 없으면 destination이 옛 ONBOARDING에 갇혀 replace('/')가 약관으로 떨어진다.
    // 스토어는 건드리지 않는다 — 서버 저장은 이번 범위 밖(잠긴 결정).
    notifyBootstrapReeval();
    router.replace('/');
  };

  const handleSkipAll = () => {
    // 탈출 경로도 완료로 취급해 재평가 신호를 발화한다(하나만 고치면 다른 쪽 사용자가 갇힘).
    // 스토어는 건드리지 않는다 — 미선택 축이 []가 아니라 null로 유지돼야 한다.
    notifyBootstrapReeval();
    router.replace('/');
  };

  return (
    <PrefStep2Screen
      selectedBudget={selectedBudget}
      selectedCompanions={selectedCompanions}
      selectedActivities={selectedActivities}
      selectedFoods={selectedFoods}
      selectedTransports={selectedTransports}
      onToggleBudget={toggleBudget}
      onToggleCompanion={toggleCompanion}
      onToggleActivity={toggleActivity}
      onToggleFood={toggleFood}
      onToggleTransport={toggleTransport}
      onBack={handleBack}
      onDone={handleDone}
      onSkipAll={handleSkipAll}
    />
  );
}
