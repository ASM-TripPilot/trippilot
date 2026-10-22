import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { guardPress, openPressGuardWindow } from '@/shared/lib/pressGuard';

import { OnboardingTourView } from './OnboardingTourView';

/**
 * c10 기능 안내 배선(TRIP-1595) — `건너뛰기`(1~5장)·`시작하기`(6장) 모두 홈으로 `replace` 한다(스택에 투어를 남기지 않는다).
 * 홈 탭 바가 같은 자리에 올라오는 순간의 둘째 탭이 홈 탭을 누르지 않게 `replace` 직전에 연타 창을 직접 연다
 * (`guardPress` 안에서도 열리지만 같은 모듈 지역 참조라 이 호출과는 별개다 — 한쪽만 지우면 의도가 사라진다).
 */
export function OnboardingTourPage(): ReactElement {
  const router = useRouter();

  const leave = guardPress(() => {
    openPressGuardWindow();
    router.replace('/');
  });

  return <OnboardingTourView onSkip={leave} onStart={leave} />;
}
