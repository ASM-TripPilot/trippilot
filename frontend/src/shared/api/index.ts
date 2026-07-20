import {
  create as createAxiosInstance,
  isAxiosError,
  type AxiosAdapter,
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';

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
    case 422:
      return 'AGE_NOT_MET';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'SOCIAL_AUTH_FAILED';
  }
}

function normalizeSocialError(error: unknown): NormalizedApiError {
  if (isAxiosError(error) && error.response) {
    const status = error.response.status;
    const data = error.response.data as
      { error?: { code?: string; existingProvider?: string } } | undefined;
    return {
      code: data?.error?.code ?? statusToSocialErrorCode(status),
      status,
      existingProvider: data?.error?.existingProvider ?? null,
    };
  }
  return { code: 'NETWORK_ERROR', status: 0, existingProvider: null };
}

export async function fetchBootstrap(): Promise<BootstrapResponse> {
  const response = await baseClient.get<BootstrapResponse>('/api/v1/bootstrap');
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
