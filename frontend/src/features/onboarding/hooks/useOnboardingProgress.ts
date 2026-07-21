/**
 * 온보딩 진행 상태 공급 훅. 진입 가드((onboarding)/index·_layout)가 라우팅을 정하려면 진행 상태가
 * 필요한데, 라우트 컴포넌트는 props 를 못 받으므로(router 가 렌더) 훅 seam 으로 주입한다 —
 * SplashGate 가 useBootstrapGate 를 구독하는 것과 같은 패턴.
 *
 * D1 축약: 신규 가입 경로는 항상 terms 부터 시작한다(약관 GRANT 는 append-only·멱등이라 재노출 안전).
 * 부트스트랩 유래 onboardingCompleted 로 완료자를 즉시 홈으로 되돌리는 배선은 후속이다 — 그 상태는
 * features/auth 의 부트스트랩 게이트에만 있고 features 간 직접 import 는 경계 규칙이 막아(shared 승격
 * 필요), 그 전까지 완료자는 SplashGate 목적지 분기(HOME)로 애초에 (onboarding) 에 들어오지 않는다.
 */
import type { OnboardingProgress } from '../model/resolveOnboardingStep';

export function useOnboardingProgress(): OnboardingProgress {
  return { termsCompleted: false, nicknameCompleted: false };
}
