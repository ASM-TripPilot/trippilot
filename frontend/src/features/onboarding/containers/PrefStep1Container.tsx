/**
 * 취향 1/2 배선 (TRIP-163 · AC3 · AC4) — 스토어 ↔ 화면 ↔ 라우터.
 * NicknameContainer/TermsContainer와 동형: 훅(여기서는 스토어) 상태를 화면 props로,
 * 화면 콜백을 스토어 액션·router 호출로 옮긴다. 저장 배선(PUT)은 없다(Q1 — 범위 밖).
 */
import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { usePreferenceStore } from '../store/preferenceStore';
import { PrefStep1Screen } from '../screens/PrefStep1Screen';

export function PrefStep1Container(): ReactElement {
  const router = useRouter();
  const styles = usePreferenceStore((state) => state.styles);
  const pace = usePreferenceStore((state) => state.pace);
  const toggleStyle = usePreferenceStore((state) => state.toggleStyle);
  const togglePace = usePreferenceStore((state) => state.togglePace);

  // '다음' — 0개 선택에도 항상 진행(인터뷰4). push로 쌓아야 2/2의 back()이 여기로 돌아온다.
  const handleNext = () => {
    router.push('/(onboarding)/pref2');
  };

  // 상·하단 '나중에 설정하고 시작' — 스토어는 건드리지 않고(미선택 축 null 유지) 홈으로.
  const handleSkipAll = () => {
    router.replace('/');
  };

  return (
    <PrefStep1Screen
      selectedStyles={styles}
      selectedPace={pace}
      onToggleStyle={toggleStyle}
      onTogglePace={togglePace}
      onNext={handleNext}
      onSkipAll={handleSkipAll}
    />
  );
}
