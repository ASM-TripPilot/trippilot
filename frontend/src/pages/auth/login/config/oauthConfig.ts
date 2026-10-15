import type { SocialProvider } from '@/shared/api';

/**
 * provider 별 실 OAuth 설정 조회(네이티브 의존 없음 — makeAuthorize 가 정적으로 끌어써도 안전).
 *
 * clientId·redirectUri·scopes 는 env(EXPO_PUBLIC_{PROVIDER}_*)에서 읽어 등록 후 값만 채우면
 * 되게 두고, discovery(authorize/token 엔드포인트 주소록)는 정적 하드코딩한다 — 네트워크 의존
 * 0 으로 테스트를 결정론으로 유지하기 위함이다(D3). clientId 가 비면 그 사실을 빈 문자열로
 * 드러내고, 실 시도 여부는 호출부(makeAuthorize)가 판단한다(빈 값 실 OAuth 금지 · INV-4).
 * google·kakao 만 채워진다. apple(네이티브 SDK)·naver(서버가 code 경로를 닫아 SDK 토큰 경로뿐, TRIP-1371)는 빈 슬롯이다.
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
  // realAuthorize.ts 가 이 값으로 AuthRequest 를 구성한다. 선택 필드 — 빈 슬롯 provider(apple·naver)는 채우지 않는다.
  usePKCE?: boolean;
  requiresState?: boolean;
}

const GOOGLE_DISCOVERY: OAuthDiscovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

// token-uri 는 백엔드 application.yml 실측값과 동일해야 한다(리포 정본, 02a §4 케이스15·16).
const KAKAO_DISCOVERY: OAuthDiscovery = {
  authorizationEndpoint: 'https://kauth.kakao.com/oauth/authorize',
  tokenEndpoint: 'https://kauth.kakao.com/oauth/token',
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
      usePKCE: true,
      requiresState: false,
    };
  }
  if (provider === 'kakao') {
    return {
      clientId: process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID ?? '',
      redirectUri: process.env.EXPO_PUBLIC_KAKAO_REDIRECT_URI ?? '',
      scopes: [],
      discovery: KAKAO_DISCOVERY,
      usePKCE: true,
      requiresState: false,
    };
  }
  return {
    clientId: '',
    redirectUri: '',
    scopes: [],
    discovery: { authorizationEndpoint: '', tokenEndpoint: '' },
  };
}
