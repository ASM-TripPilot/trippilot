import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { guardPress, openPressGuardWindow } from '@/shared/lib/pressGuard';

import { OnboardingTourView } from './OnboardingTourView';

/**
 * c10 기능 안내 배선(TRIP-1595) — `건너뛰기`(1~5장)·`시작하기`(6장) 모두 홈으로 `replace` 한다(스택에 투어를 남기지 않는다).
 * 홈 탭 바가 같은 자리에 올라오는 순간의 둘째 탭이 홈 탭을 누르지 않게 `replace` 직전에 연타 창을 직접 연다
 * (`guardPress` 안에서도 열리지만 같은 모듈 지역 참조라 이 호출과는 별개다 — 한쪽만 지우면 의도가 사라진다).
 *
 * 목적지는 `'/'` 가 아니라 `'/(tabs)'` 다(TRIP-1597) — app/ 에 `'/'` 로 풀리는 화면이 둘((onboarding)/index · (tabs)/index)이라
 * `'/'` 는 온보딩 index 로 풀리고, 완료 계정에겐 그 그룹이 Stack.Protected 로 잠겨 있어 이동이 조용히 무시된다.
 * 로그인·재동의의 `'/'` 는 "게이트가 다시 판정" 의도라 가드 전환이 화면을 옮기지만, 여기는 게이트가 이미 HOME 이라 직접 간다.
 */
export function OnboardingTourPage(): ReactElement {
  const router = useRouter();

  const leave = guardPress(() => {
    openPressGuardWindow();
    router.replace('/(tabs)');
  });

  return <OnboardingTourView onSkip={leave} onStart={leave} />;
}
