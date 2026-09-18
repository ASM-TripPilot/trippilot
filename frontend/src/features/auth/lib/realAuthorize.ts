import { AuthRequest, ResponseType, makeRedirectUri } from 'expo-auth-session';

import type { SocialProvider } from '@/shared/api';

import type { AuthorizeResult } from '../model/useSocialLogin';
import type { OAuthProviderConfig } from '../config/oauthConfig';

/**
 * 실 소셜 OAuth 인가(명령형 PKCE). makeAuthorize 가 토글 off + clientId 존재일 때 `await import` 로만
 * 이 모듈을 로드하므로, expo-auth-session(네이티브)은 실 경로 진입 순간에만 평가된다 — makeAuthorize.ts
 * 의 정적 그래프에 실리지 않아 Hermes 부팅 크래시를 피한다(D4). 이 파일이 auth/lib 에서 유일하게
 * expo-auth-session 을 참조한다.
 *
 * AuthRequest 가 config.usePKCE 에 따라 codeVerifier 를 앱 안에서 만들고(naver 만 false —
 * TRIP-172 결함 C), promptAsync 가 로그인 창을 띄워 authorizationCode 를 받는다. config.requiresState
 * 인 provider(naver)는 state 를 직접 생성해 싣는다 — 실 라이브러리는 state 를 안 주면 스스로
 * 만들지만(PKCE.generateRandom), 그 자동 생성에 기대지 않고 명시 전달해 CSRF 방어가 항상
 * 켜져 있음을 보장한다. 서버 교환에 필요한 3필드(authorizationCode·codeVerifier·redirectUri)만
 * 정규화해 넘기고 어떤 client secret 도 담지 않는다(SEC-AUTH). PKCE 가 꺼진 provider 는 실 라이브러리가
 * codeVerifier 를 만들지 않으므로(usePKCE:false 면 ensureCodeIsSetupAsync 를 건너뜀), 빈 문자열
 * 대신 별도 불투명 토큰으로 채운다 — 백엔드 SocialLoginRequest.codeVerifier 가 @NotBlank 라 빈
 * 문자열을 보내면 400 으로 즉사한다(결함 C). redirectUri 는 env 값을 우선 쓰고, 미설정 시 앱
 * 스킴에서 파생한다(D1). 사용자 취소/닫힘은 cancel/dismiss 로, 그 외 실패는 조용히 넘기지 않고
 * throw 한다(INV-4).
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
    usePKCE: config.usePKCE ?? true,
    ...(config.requiresState ? { state: generateOpaqueToken() } : {}),
  });

  const result = await request.promptAsync(config.discovery);

  switch (result.type) {
    case 'success':
      return {
        type: 'success-code',
        authorizationCode: result.params.code,
        codeVerifier: request.codeVerifier ?? generateOpaqueToken(),
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

/** CSRF state 값 · PKCE 미사용 provider 의 codeVerifier 대체값으로 쓰는 불투명 랜덤 토큰. */
function generateOpaqueToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
