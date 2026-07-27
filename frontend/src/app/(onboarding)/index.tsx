import { Redirect } from 'expo-router';

import { useOnboardingProgress } from '@/features/onboarding/model/useOnboardingProgress';
import { resolveOnboardingStep } from '@/features/onboarding/model/resolveOnboardingStep';

/**
 * 온보딩 그룹 진입 라우트 — 죽은 화면이 아니라 진행 단계로 리다이렉트한다. 완료면 홈('/', 루트
 * 게이트가 목적지를 재판정), 미완이면 약관으로 보낸다. (D1 축약: progress 가 {c,c} 라 step 은
 * terms|done 뿐 — nickname 직행은 후속.)
 */
export default function OnboardingIndex() {
  const progress = useOnboardingProgress();
  if (resolveOnboardingStep(progress) === 'done') {
    return <Redirect href="/" />;
  }
  return <Redirect href="/(onboarding)/terms" />;
}
