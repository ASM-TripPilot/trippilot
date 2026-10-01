import { ReconsentPage } from '@/pages/reconsent';

/** 약관 재동의 — 얇은 라우트, 배선은 `pages/reconsent` 가 진다(TRIP-937). 가드(`Stack.Protected`)는 `SplashGate` 몫. */
export default function ReconsentRoute() {
  return <ReconsentPage />;
}
