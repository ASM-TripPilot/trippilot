import type { SocialProvider } from '@/shared/api';

import type { Authorize } from '../hooks/useSocialLogin';
import { getOAuthConfig } from './oauthConfig';

/**
 * dev fake OAuth provider 팩토리(DI 씨앗). `signIn(provider, makeAuthorize(provider))` 로 주입되어,
 * env 토글 EXPO_PUBLIC_AUTH_FAKE 가 켜진 dev 경로에서만 env EXPO_PUBLIC_AUTH_FAKE_OUTCOME 대로 가짜
 * 인가 결과를 낸다(cancel|dismiss, 그 외/미지정은 success). 결과 출처를 목 모듈이 아니라 env 로 둔 이유는
 * `@/mocks/*` 를 앱 정적 그래프에서 끊기 위함이다(noMswInStaticGraph 가드 · 게이트①-2 계약).
 * 성공 결과에는 PKCE codeVerifier 만 담고 시크릿은 담지 않는다(SEC-AUTH). 토글이 꺼진 실 빌드에서는
 * getOAuthConfig(provider) 의 clientId 가 있어야 실 OAuth(realAuthorize)로 위임하고, 없으면 빈 값으로
 * 몰래 시도하지 않고 throw 한다(INV-4). expo-auth-session 은 realAuthorize 를 `await import` 로 지연
 * 로드해서만 닿으므로 이 파일의 정적 그래프에 실리지 않는다(D4 · Hermes 부팅 격리).
 */
export function makeAuthorize(provider: SocialProvider): Authorize {
  return async () => {
    if (!isFakeAuthEnabled()) {
      const config = getOAuthConfig(provider);
      if (!config.clientId) {
        throw new Error(
          `실 OAuth client 미설정: ${provider} clientId 가 비어 있어 인가할 수 없습니다.`
        );
      }
      const { realAuthorize } = await import('./realAuthorize');
      return realAuthorize(provider, config);
    }
    switch (process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME) {
      case 'cancel':
        return { type: 'cancel' };
      case 'dismiss':
        return { type: 'dismiss' };
      default:
        return {
          type: 'success',
          authorizationCode: 'fake-code',
          codeVerifier: 'fake-verifier',
          redirectUri: `trippilot://oauth/${provider}`,
        };
    }
  };
}

function isFakeAuthEnabled(): boolean {
  const flag = process.env.EXPO_PUBLIC_AUTH_FAKE;
  return flag === '1' || flag === 'true';
}
