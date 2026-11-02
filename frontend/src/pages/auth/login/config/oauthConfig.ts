import { Platform } from 'react-native';

import type { SocialProvider } from '@/shared/api';

/**
 * provider 별 실 OAuth 설정 조회(네이티브 의존 없음 — makeAuthorize 가 정적으로 끌어써도 안전).
 *
 * clientId·redirectUri·scopes 는 env(EXPO_PUBLIC_{PROVIDER}_*)에서 읽어 등록 후 값만 채우면
 * 되게 두고, discovery(authorize/token 엔드포인트 주소록)는 정적 하드코딩한다 — 네트워크 의존
 * 0 으로 테스트를 결정론으로 유지하기 위함이다(D3). clientId 가 비면 그 사실을 빈 문자열로
 * 드러내고, 실 시도 여부는 호출부(makeAuthorize)가 판단한다(빈 값 실 OAuth 금지 · INV-4).
 * google·kakao 만 채워진다. 웹(Platform.OS==='web', TRIP-1649)은 같은 팝업 OAuth 를 쓰되 클라이언트·redirect·state 가 iOS 와 다르다 — webOverride. apple(네이티브 SDK)은 빈 슬롯이고,
 * naver 는 iOS 에서 빈 슬롯이다(서버가 code 경로를 닫아 SDK 토큰 경로뿐, TRIP-1371). 웹에서만 implicit(`responseType:'token'`) 팝업 슬롯이 채워진다(TRIP-1650 · webNaverConfig).
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
  // 'token' = implicit(토큰이 redirect 의 `#` 뒤로 바로 옴, 웹 네이버). 비우면 'code'. 'token' 이면 realAuthorize 가 state 를 항상 싣는다.
  responseType?: 'code' | 'token';
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

// 네이버 웹은 implicit 이라 tokenEndpoint 를 부르지 않는다 — 타입을 채우는 값일 뿐이다.
const NAVER_DISCOVERY: OAuthDiscovery = {
  authorizationEndpoint: 'https://nid.naver.com/oauth2.0/authorize',
  tokenEndpoint: 'https://nid.naver.com/oauth2.0/token',
};

const DEFAULT_GOOGLE_SCOPES = ['openid', 'profile', 'email'];

function parseScopes(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return raw.split(/\s+/).filter((scope) => scope.length > 0);
}

/**
 * 웹 팝업 OAuth 의 redirect 는 접속 origin 에서 계산한다 — env 의 *_REDIRECT_URI(iOS 역방향 스킴)는 같은 .env 로
 * 웹 번들에도 인라인되지만 웹에선 쓰지 않는다. origin 은 이 함수가 웹 분기에서만 부른다(iOS 엔 location 이 없다).
 */
function webRedirectUri(provider: SocialProvider): string {
  const origin = globalThis.location?.origin;
  if (!origin) {
    throw new Error(
      '웹 로그인 redirect 를 계산할 수 없습니다: 접속 origin 이 없습니다.'
    );
  }
  return `${origin}/oauth/${provider}`;
}

/**
 * 웹 네이버: PKCE 없는 implicit — 앱이 만든 state 가 유일한 CSRF 방어라 requiresState 를 켠다.
 * client secret 은 읽지 않는다(웹 번들에 실리면 안 된다 — naverAuthorize.ts 1파일만 읽는다).
 */
function webNaverConfig(): OAuthProviderConfig {
  return {
    clientId: process.env.EXPO_PUBLIC_NAVER_CLIENT_ID ?? '',
    redirectUri: webRedirectUri('naver'),
    scopes: [],
    discovery: NAVER_DISCOVERY,
    usePKCE: false,
    requiresState: true,
    responseType: 'token',
  };
}

export function getOAuthConfig(provider: SocialProvider): OAuthProviderConfig {
  if (provider === 'naver' && Platform.OS === 'web') {
    return webNaverConfig();
  }
  const config = nativeOAuthConfig(provider);
  if (
    Platform.OS !== 'web' ||
    (provider !== 'google' && provider !== 'kakao')
  ) {
    return config;
  }
  return {
    ...config,
    // 구글 웹은 웹 애플리케이션 유형 클라이언트 — iOS 클라이언트 ID 로 폴백하지 않는다(비면 makeAuthorize 가 인가 전에 던진다).
    clientId:
      provider === 'google'
        ? (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '')
        : config.clientId,
    redirectUri: webRedirectUri(provider),
    // 웹은 앱이 state 를 직접 만들어 싣고 돌아온 값과 대조한다(realAuthorize · AC-W3-SEC-1).
    requiresState: true,
  };
}

function nativeOAuthConfig(provider: SocialProvider): OAuthProviderConfig {
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
