import { AuthRequest, ResponseType, makeRedirectUri } from 'expo-auth-session';

import type { SocialProvider } from '@/shared/api';

import type { AuthorizeResult } from '../hooks/useSocialLogin';
import type { OAuthProviderConfig } from './oauthConfig';

/**
 * 실 소셜 OAuth 인가(명령형 PKCE). makeAuthorize 가 토글 off + clientId 존재일 때 `await import` 로만
 * 이 모듈을 로드하므로, expo-auth-session(네이티브)은 실 경로 진입 순간에만 평가된다 — makeAuthorize.ts
 * 의 정적 그래프에 실리지 않아 Hermes 부팅 크래시를 피한다(D4). 이 파일이 auth/lib 에서 유일하게
 * expo-auth-session 을 참조한다.
 *
 * AuthRequest(usePKCE:true) 가 codeVerifier 를 앱 안에서 만들고, promptAsync 가 로그인 창을 띄워
 * authorizationCode 를 받는다. 서버 교환에 필요한 3필드(authorizationCode·codeVerifier·redirectUri)만
 * 정규화해 넘기고 어떤 client secret 도 담지 않는다(SEC-AUTH). redirectUri 는 env 값을 우선 쓰고,
 * 미설정 시 앱 스킴에서 파생한다(D1). 사용자 취소/닫힘은 cancel/dismiss 로, 그 외 실패는 조용히 넘기지
 * 않고 throw 한다(INV-4).
 */
export async function realAuthorize(
  provider: SocialProvider,
  config: OAuthProviderConfig
): Promise<AuthorizeResult> {
  const redirectUri =
    config.redirectUri ||
    makeRedirectUri({ scheme: 'trippilot', path: `oauth/${provider}` });

  const request = new AuthRequest({
    clientId: config.clientId,
    scopes: config.scopes,
    redirectUri,
    responseType: ResponseType.Code,
    usePKCE: true,
  });

  const result = await request.promptAsync(config.discovery);

  switch (result.type) {
    case 'success':
      return {
        type: 'success',
        authorizationCode: result.params.code,
        codeVerifier: request.codeVerifier ?? '',
        redirectUri,
      };
    case 'dismiss':
      return { type: 'dismiss' };
    case 'cancel':
      return { type: 'cancel' };
    default:
      throw new Error(
        `소셜 로그인 인가 실패: promptAsync 가 '${result.type}' 를 반환했습니다.`
      );
  }
}
