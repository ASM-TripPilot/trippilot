/**
 * 온보딩 남은 첫 단계 계산 (BR-U0-26 '온보딩 잔여' · frontend-components §7 · TRIP-1421) — 순수 함수.
 *
 * 약관 > 닉네임 > 취향 순으로 첫 미완 단계를 고른다. 결과에 홈은 없다 — 온보딩 그룹이 열려 있다는 것
 * 자체가 서버 기준 미완이고, 그룹 안의 `'/'`는 온보딩 index 로 되풀린다. 셋 다 끝났으면 완료를 다시
 * 시도하는 취향 2/2(pref2)로 보낸다.
 */

export type OnboardingStep = 'terms' | 'nickname' | 'location' | 'pref2';

export interface OnboardingProgress {
  termsCompleted: boolean;
  nicknameCompleted: boolean;
  preferencesSaved: boolean;
}

export function resolveOnboardingStep(
  progress: OnboardingProgress
): OnboardingStep {
  if (!progress.termsCompleted) {
    return 'terms';
  }
  if (!progress.nicknameCompleted) {
    return 'nickname';
  }
  return progress.preferencesSaved ? 'pref2' : 'location';
}
