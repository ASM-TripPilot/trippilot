import type { ReactElement } from 'react';
import { Redirect } from 'expo-router';

import { resolveOnboardingStep } from '@/features/onboarding';

import { useOnboardingProgress } from '../model/useOnboardingProgress';

/**
 * 온보딩 그룹 진입 — 서버 판정이 오면 남은 첫 단계로 한 번 보낸다(TRIP-1421). 판정 전엔 아무것도 그리지
 * 않는다(terms 를 한 프레임 번쩍이지 않게). `'/'`로는 보내지 않는다 — 이 그룹 안의 `'/'`는 여기로 되돌아온다.
 */
export function OnboardingEntryPage(): ReactElement | null {
  const progress = useOnboardingProgress();
  if (progress === null) {
    return null;
  }
  return <Redirect href={`/(onboarding)/${resolveOnboardingStep(progress)}`} />;
}
