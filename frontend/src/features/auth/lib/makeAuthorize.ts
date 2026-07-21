import type { SocialProvider } from '@/shared/api';

import type { Authorize } from '../hooks/useSocialLogin';

/**
 * dev fake OAuth provider 팩토리(DI 씨앗). `signIn(provider, makeAuthorize(provider))` 로 주입되어,
 * env 토글 EXPO_PUBLIC_AUTH_FAKE 가 켜진 dev 경로에서만 env EXPO_PUBLIC_AUTH_FAKE_OUTCOME 대로 가짜
 * 인가 결과를 낸다(cancel|dismiss, 그 외/미지정은 success). 결과 출처를 목 모듈이 아니라 env 로 둔 이유는
 * `@/mocks/*` 를 앱 정적 그래프에서 끊기 위함이다(noMswInStaticGraph 가드 · 게이트①-2 계약).
 * 성공 결과에는 PKCE codeVerifier 만 담고 시크릿은 담지 않는다(SEC-AUTH). 토글이 꺼진 실 빌드에는
 * 실 OAuth(expo-auth-session)가 아직 없어(겹2) 거부한다 — 가짜 성공을 흘리지 않기 위함이다.
 */
export function makeAuthorize(provider: SocialProvider): Authorize {
  return async () => {
    if (!isFakeAuthEnabled()) {
      throw new Error(
        '실 OAuth 미배선(겹2): EXPO_PUBLIC_AUTH_FAKE 없이 인가할 수 없습니다.'
      );
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
