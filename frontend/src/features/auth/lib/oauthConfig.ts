import type { SocialProvider } from '@/shared/api';

/**
 * provider 별 실 OAuth 설정 조회(네이티브 의존 없음 — makeAuthorize 가 정적으로 끌어써도 안전).
 *
 * clientId·redirectUri·scopes 는 env(EXPO_PUBLIC_GOOGLE_*)에서 읽어 등록 후 값만 채우면 되게 두고,
 * discovery(authorize/token 엔드포인트 주소록)는 정적 하드코딩한다 — 네트워크 의존 0 으로 테스트를
 * 결정론으로 유지하기 위함이다(D3). clientId 가 비면 그 사실을 빈 문자열로 드러내고, 실 시도 여부는
 * 호출부(makeAuthorize)가 판단한다(빈 값 실 OAuth 금지 · INV-4). google 만 채우고 kakao/naver/apple 은
 * 빈 슬롯이다(비표준 OAuth 배선은 후속 · RO3).
 */
export interface OAuthDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

export interface OAuthProviderConfig {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  discovery: OAuthDiscovery;
}

const GOOGLE_DISCOVERY: OAuthDiscovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

const DEFAULT_GOOGLE_SCOPES = ['openid', 'profile', 'email'];

function parseScopes(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return raw.split(/\s+/).filter((scope) => scope.length > 0);
}

export function getOAuthConfig(provider: SocialProvider): OAuthProviderConfig {
  if (provider === 'google') {
    return {
      clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '',
      redirectUri: process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI ?? '',
      scopes: parseScopes(
        process.env.EXPO_PUBLIC_GOOGLE_SCOPES,
        DEFAULT_GOOGLE_SCOPES
      ),
      discovery: GOOGLE_DISCOVERY,
    };
  }
  return {
    clientId: '',
    redirectUri: '',
    scopes: [],
    discovery: { authorizationEndpoint: '', tokenEndpoint: '' },
  };
}
