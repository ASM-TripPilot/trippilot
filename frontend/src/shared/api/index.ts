import {
  create as createAxiosInstance,
  isAxiosError,
  type AxiosAdapter,
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';

import { clearTokens, getTokens, saveTokens } from '@/shared/storage';

import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from './tokenManager';

export type SocialProvider = 'google' | 'apple' | 'kakao' | 'naver';

export interface BootstrapResponse {
  appUpdate: { status: string; minSupportedVersion: string };
  reconsent: { required: boolean; termsTypes: string[] };
  session: {
    state: 'AUTHENTICATED' | 'GUEST' | 'ONBOARDING_INCOMPLETE';
    onboardingCompleted: boolean;
  };
}

export interface AgeConfirmation {
  method: 'SELF_DECLARED' | 'BIRTH_DATE';
  birthDate?: string;
}

export interface SocialLoginBody {
  authorizationCode: string;
  codeVerifier: string;
  redirectUri: string;
  ageConfirmation?: AgeConfirmation;
}

export interface AccountSummary {
  accountId: string;
  status: string;
  email: string | null;
  socialProviders: string[];
  onboardingCompleted: boolean;
}

export interface TokenPair {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  isNewUser: boolean;
  account: AccountSummary;
}

export interface NormalizedApiError {
  code: string;
  status: number;
  existingProvider?: string | null;
}

export interface AuthedApiClientOptions {
  baseURL: string;
  adapter?: AxiosAdapter;
  getAccessToken: () => string | null | undefined;
  refreshTokens: () => Promise<string>;
  onSessionExpired: () => void;
}

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

/**
 * 인증 요청 전용 axios 인스턴스를 만든다. accessToken 을 헤더에 첨부하고,
 * 401 응답에는 리프레시를 single-flight 로 직렬화한다 — 동시 다발 401 이 와도
 * 리프레시는 정확히 1회만 실행되고 나머지 요청은 그 결과를 공유해 재시도한다.
 * 회전 토큰(rotating refresh)은 병렬 리프레시를 재사용으로 오탐하므로 직렬화가 정확성 요건이다.
 */
export function createAuthedApiClient(
  options: AuthedApiClientOptions
): AxiosInstance {
  const { baseURL, adapter, getAccessToken, refreshTokens, onSessionExpired } =
    options;
  const client = createAxiosInstance({ baseURL, adapter });

  let refreshPromise: Promise<string> | null = null;

  client.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const status = error.response?.status;
      const config = error.config as RetriableRequestConfig | undefined;
      if (status !== 401 || !config || config._retry) {
        return Promise.reject(error);
      }
      config._retry = true;

      try {
        if (!refreshPromise) {
          refreshPromise = refreshTokens().finally(() => {
            refreshPromise = null;
          });
        }
        await refreshPromise;
      } catch (refreshError) {
        onSessionExpired();
        return Promise.reject(refreshError);
      }

      return client(config);
    }
  );

  return client;
}

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080';

const baseClient = createAxiosInstance({ baseURL: API_BASE_URL });

function statusToSocialErrorCode(status: number): string {
  switch (status) {
    case 401:
      return 'SOCIAL_AUTH_FAILED';
    case 409:
      return 'SOCIAL_EMAIL_CONFLICT';
    case 403:
      return 'AGE_NOT_MET';
    case 422:
      return 'AGE_NOT_MET';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'SOCIAL_AUTH_FAILED';
  }
}

// 서버 실코드 → 프론트 계약 코드 번역표(TRIP-172 경고#1). 서버·openapi 드리프트가
// 여기로 하나씩 흡수된다 — 화면은 이 매핑을 몰라도 된다.
const SERVER_ERROR_CODE_TRANSLATIONS: Record<string, string> = {
  AGE_REQUIREMENT_NOT_MET: 'AGE_NOT_MET',
};

function translateServerErrorCode(code: string): string {
  return SERVER_ERROR_CODE_TRANSLATIONS[code] ?? code;
}

function normalizeSocialError(error: unknown): NormalizedApiError {
  if (isAxiosError(error) && error.response) {
    const status = error.response.status;
    const data = error.response.data as
      { error?: { code?: string; existingProvider?: string } } | undefined;
    return {
      code: translateServerErrorCode(
        data?.error?.code ?? statusToSocialErrorCode(status)
      ),
      status,
      existingProvider: data?.error?.existingProvider ?? null,
    };
  }
  return { code: 'NETWORK_ERROR', status: 0, existingProvider: null };
}

export async function fetchBootstrap(): Promise<BootstrapResponse> {
  // TRIP-172(결함 A-2) — baseClient(무인증)로 보내면 로그인 직후에도 서버가 계속 GUEST 를
  // 돌려준다. authedClient 는 아래에서 선언되지만(모듈 스코프 const), 이 함수는 호출 시점에만
  // 실행되므로 모듈 로드가 끝난 뒤에는 항상 초기화돼 있다(순환 참조 아님).
  const response =
    await authedClient.get<BootstrapResponse>('/api/v1/bootstrap');
  return response.data;
}

export async function postSocialLogin(
  provider: SocialProvider,
  body: SocialLoginBody
): Promise<TokenPair> {
  try {
    const response = await baseClient.post<TokenPair>(
      `/api/v1/auth/social/${provider}`,
      body
    );
    return response.data;
  } catch (error) {
    throw normalizeSocialError(error);
  }
}

/**
 * 리프레시 토큰으로 토큰을 재발급받는 래퍼. refresh 토큰은 secure-store 에만 있으므로 거기서 읽어
 * POST /api/v1/auth/token/refresh(security:[] — 무인증) 로 회전하고, 회전된 access/refresh 를 저장·
 * 홀더 반영한 뒤 새 access 를 반환한다. authed 클라이언트가 401 single-flight 에서 인자 없이 호출한다.
 * baseClient(무인증)로 보낸다 — authed 클라이언트로 보내면 401 인터셉터가 자기 자신을 재귀 호출한다.
 */
export async function refreshTokens(): Promise<string> {
  const stored = await getTokens();
  const response = await baseClient.post<TokenPair>(
    '/api/v1/auth/token/refresh',
    { refreshToken: stored?.refreshToken }
  );
  const { accessToken, refreshToken } = response.data;
  await saveTokens({ accessToken, refreshToken });
  setAccessToken(accessToken);
  return accessToken;
}

/**
 * 세션 만료(리프레시 실패) 처리 — 죽은 토큰을 홀더·저장소 양쪽에서 파기한다. 라우팅은 하지 않는다:
 * 이 모듈은 router 를 몰라야(D3) authWiring 통합테스트가 node 에서 로드된다. 토큰을 지우면 다음
 * 부트스트랩이 목적지를 LOGIN 으로 재판정하므로 로그인 복귀는 그 흐름이 담당한다.
 */
function onSessionExpired(): void {
  clearAccessToken();
  void clearTokens();
}

/**
 * 인증 필요 API 전용 클라이언트 인스턴스. 요청 인터셉터가 홀더 토큰을 Bearer 로 싣고, 401 에는
 * refreshTokens 를 single-flight 로 돌린 뒤 재시도한다(createAuthedApiClient 재사용 — 재구현 아님).
 */
const authedClient = createAuthedApiClient({
  baseURL: API_BASE_URL,
  getAccessToken,
  refreshTokens,
  onSessionExpired,
});

// ── TRIP-162 온보딩(약관·닉네임) API (openapi.yaml 계약 shape) ─────────────
// 판정 권위는 서버에 있다 — 이 함수들은 서버 계약을 그대로 실어 나르는 얇은 래퍼다.

export interface TermsVersion {
  termsType: string;
  version: string;
  body: string;
  effectiveAt: string;
  reconsentRequired: boolean;
}

export type ConsentAction = 'GRANT' | 'REVOKE';

/** BR-U0-12 — 증적에는 **서버가 준 약관 버전 그대로** 되돌린다. 채널은 서버가 기록한다. */
export interface ConsentInput {
  termsType: string;
  termsVersion: string;
  action: ConsentAction;
}

export type NicknameCheckReason = 'OK' | 'TAKEN' | 'BANNED_WORD';

export interface NicknameCheckResult {
  available: boolean;
  reason: NicknameCheckReason;
}

export async function fetchTerms(): Promise<TermsVersion[]> {
  const response = await baseClient.get<TermsVersion[]>('/api/v1/terms');
  return response.data;
}

export async function submitConsents(consents: ConsentInput[]): Promise<void> {
  await authedClient.post('/api/v1/me/consents', { consents });
}

export async function fetchNicknameSuggestions(): Promise<string[]> {
  const response = await authedClient.post<{ suggestions: string[] }>(
    '/api/v1/nickname/suggestions'
  );
  return response.data.suggestions;
}

/** 중복·금칙어 판정은 서버 권한이다 — 클라는 이 결과를 받아 표시만 한다(루트 CLAUDE.md). */
export async function checkNickname(
  nickname: string
): Promise<NicknameCheckResult> {
  const response = await authedClient.post<NicknameCheckResult>(
    '/api/v1/nickname/check',
    { nickname }
  );
  return response.data;
}

export async function updateNickname(nickname: string): Promise<void> {
  await authedClient.patch('/api/v1/me/profile/nickname', { nickname });
}

export async function completeOnboarding(): Promise<void> {
  await authedClient.post('/api/v1/onboarding/complete');
}
