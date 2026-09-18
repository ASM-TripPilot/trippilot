/**
 * 온보딩 잔여 단계 계산 (BR-U0-26 '온보딩 잔여' · AC C1~C3) — 순수 함수.
 *
 * 약관이 우선이다: 약관 미완료면 닉네임 상태와 무관하게 terms. 약관이 끝났으면 닉네임만 보고
 * nickname/done 을 가른다 — 재진입 사용자가 이미 동의한 약관을 다시 보지 않게 한다.
 */

export type OnboardingStep = 'terms' | 'nickname' | 'done';

export interface OnboardingProgress {
  termsCompleted: boolean;
  nicknameCompleted: boolean;
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
  return 'done';
}
