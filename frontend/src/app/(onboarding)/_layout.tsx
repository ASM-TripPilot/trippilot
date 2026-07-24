import { Redirect, Stack } from 'expo-router';

import { useOnboardingProgress } from '@/features/onboarding/model/useOnboardingProgress';
import { resolveOnboardingStep } from '@/features/onboarding/model/resolveOnboardingStep';

/**
 * 온보딩 그룹 레이아웃 — 완료자만 홈으로 되돌리고(온보딩에 갇히지 않게), 미완자는 되돌리지 않고
 * 자식 화면을 그대로 그린다. 단계 진입 판정은 index 가 맡고 _layout 은 완료자 방어만 한다:
 * _layout 이 미완자까지 특정 단계로 매번 Redirect 하면 terms↔nickname 무한루프가 되기 때문이다.
 */
export default function OnboardingLayout() {
  const progress = useOnboardingProgress();
  if (resolveOnboardingStep(progress) === 'done') {
    return <Redirect href="/" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
