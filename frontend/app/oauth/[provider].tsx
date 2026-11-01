import { OAuthRedirectPage } from '@/pages/auth/oauth-redirect';

/**
 * 소셜 로그인 팝업 복귀 `oauth/[provider]`(웹, TRIP-1649) — 얇은 라우트. provider 는 URL 모양일 뿐 읽지 않는다
 * (네이버 웹도 같은 라우트가 받는다). 어느 `Stack.Protected` 에도 넣지 않았다 — 팝업은 로그인 전 새 창이다.
 */
export default function OAuthRedirectRoute() {
  return <OAuthRedirectPage />;
}
