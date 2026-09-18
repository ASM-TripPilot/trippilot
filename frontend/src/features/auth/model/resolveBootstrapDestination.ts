import type { BootstrapResponse } from '@/shared/api';

export type { BootstrapResponse };

export type BootstrapDestination =
  'FORCE_UPDATE' | 'RECONSENT' | 'LOGIN' | 'ONBOARDING' | 'HOME';

/**
 * 부트스트랩 1왕복 결과를 목적지로 옮기는 순수 함수(부수효과 0).
 * 우선순위: 강제 업데이트 > 재동의 > 세션. 서버 판정이 정본이며,
 * 예상 밖 세션 값은 로컬 토큰 유무로 보수적으로 폴백한다.
 *
 * TRIP-172(결함 A) — 서버는 `ONBOARDING_INCOMPLETE` 세션 상태를 보내지 않는다(D7 실측).
 * 그래서 `AUTHENTICATED` 인데 `onboardingCompleted:false`인 신규 가입자를 프론트가 직접
 * 파생 판정해 ONBOARDING 으로 보낸다 — 안 그러면 약관 동의를 건너뛰고 곧장 HOME 으로
 * 새어버린다(US-ONB-02). 완료 사용자만 HOME 이다.
 */
export function resolveBootstrapDestination(
  bootstrap: BootstrapResponse,
  hasLocalToken: boolean
): BootstrapDestination {
  if (bootstrap.appUpdate.status === 'FORCED') {
    return 'FORCE_UPDATE';
  }
  if (bootstrap.reconsent.required) {
    return 'RECONSENT';
  }
  switch (bootstrap.session.state) {
    case 'GUEST':
      return 'LOGIN';
    case 'ONBOARDING_INCOMPLETE':
      return 'ONBOARDING';
    case 'AUTHENTICATED':
      return bootstrap.session.onboardingCompleted ? 'HOME' : 'ONBOARDING';
    default:
      return hasLocalToken ? 'HOME' : 'LOGIN';
  }
}
