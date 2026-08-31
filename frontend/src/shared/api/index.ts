import {
  create as createAxiosInstance,
  isAxiosError,
  type AxiosAdapter,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';

import { clearTokens, getTokens, saveTokens } from '@/shared/storage';
import type { ErrorResponseErrorFieldsItem } from './generated/schemas';
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from './tokenManager';

/**
 * 서버 HTTP 계층 전체 — axios 인스턴스 두 벌(무인증 baseClient · 인증 authedClient) + 401 리프레시
 * single-flight(BR-U0-07/08의 클라 측) + 에러 정규화. 무인증 화이트리스트(SEC-04)는 postSocialLogin·
 * refreshTokens·fetchTerms·fetchBootstrap 이전 온보딩 응답부뿐 — refreshTokens 가 authedClient 를
 * 타면 401 을 받는 순간 자기 인터셉터가 자기를 다시 부르는 재귀 폭탄이 된다.
 */

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
  method: 'BIRTH_DATE' | 'SELF_DECLARED';
  birthDate?: string | null;
}

export interface SocialLoginBody {
  authorizationCode: string;
  codeVerifier: string;
  redirectUri: string;
  ageConfirmation?: AgeConfirmation;
}

/** `/auth/social/{provider}/token`(네이티브 SDK access token 경로, TRIP-210) 요청 바디.
 * deviceId 는 openapi 상 선택 필드지만 프론트에 기기 식별자 개념이 없어 의도적으로 넣지 않는다
 * (D7 — 미제공 시 서버가 임의 부여). 필드에 없으면 실수로라도 실릴 수 없다. */
export interface SocialTokenLoginBody {
  accessToken: string;
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
  /** VALIDATION_ERROR 의 어느 필드가 문제였는지(선택). TRIP-248 — 연령확인 누락 거절을 다른
   * 400 과 구분하는 유일한 단서라, status 가 아니라 이 값으로 판정한다. 원소의 `field`·`reason`
   * 은 openapi 상 둘 다 required 가 아니다 — 읽는 쪽이 부재를 견뎌야 한다. */
  fields?: ErrorResponseErrorFieldsItem[];
}

export interface AuthedApiClientOptions {
  baseURL: string;
  /** 유닛테스트 DI 전용 — 프로덕션 authedClient 는 넘기지 않고 axios 기본 adapter 를 쓴다. */
  adapter?: AxiosAdapter;
  getAccessToken: () => string | null | undefined;
  refreshTokens: () => Promise<string>;
  onSessionExpired: () => void;
}

export interface TermsVersion {
  termsType: string;
  version: string;
  body: string;
  effectiveAt: string;
  reconsentRequired: boolean;
}

export type ConsentAction = 'GRANT' | 'REVOKE';

export interface ConsentInput {
  termsType: string;
  termsVersion: string;
  action: ConsentAction;
}

export type NicknameCheckReason =
  'OK' | 'TOO_SHORT' | 'TOO_LONG' | 'BANNED_WORD' | 'TAKEN';

export interface NicknameCheckResult {
  available: boolean;
  reason: NicknameCheckReason;
}

/** 재시도 여부를 요청 자체에 표시하는 내부 마커 — 요청당 정확히 1회만 리프레시를 태운다(A4). */
interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

/**
 * 팩토리 — 토큰 부착 요청 인터셉터 + 401 리프레시 응답 인터셉터를 단 axios 인스턴스를 만든다.
 * 순수 주입식(DI)이라 유닛테스트가 실제 네트워크 없이 adapter 만 바꿔 검증할 수 있다.
 *
 * 401 을 만나면: 이미 재시도한 요청(_retry)이면 그대로 거부(A4, 두 번째 리프레시 없음) — 아니면
 * 재시도 표시 후 리프레시를 태운다. 동시에 여러 요청이 401 을 만나도 리프레시는 refreshPromise
 * 하나로 합쳐 1회만 실행되고(single-flight), 성공·실패 어느 쪽이든 finally 로 슬롯을 비워
 * 다음 401 이 새 리프레시를 다시 탈 수 있게 한다(A6). 리프레시 자체가 실패하면(원인 불문)
 * onSessionExpired 를 부르고 원 요청은 거부로 끝난다.
 */
export function createAuthedApiClient(
  options: AuthedApiClientOptions
): AxiosInstance {
  const client = createAxiosInstance({
    baseURL: options.baseURL,
    adapter: options.adapter,
  });

  let refreshPromise: Promise<string> | null = null;

  client.interceptors.request.use((config) => {
    const token = options.getAccessToken();
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (!isAxiosError(error) || error.response?.status !== 401) {
        return Promise.reject(error);
      }
      const config = error.config as RetriableRequestConfig | undefined;
      if (!config || config._retry) {
        return Promise.reject(error);
      }
      config._retry = true;

      try {
        if (!refreshPromise) {
          refreshPromise = options.refreshTokens().finally(() => {
            refreshPromise = null;
          });
        }
        await refreshPromise;
        return client(config);
      } catch (refreshError) {
        options.onSessionExpired();
        return Promise.reject(refreshError);
      }
    }
  );

  return client;
}

const API_BASE_URL = `${
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
}/api/v1`;

/** 무인증 클라이언트 — SEC-04 화이트리스트(소셜 로그인·토큰 갱신·약관 조회)가 여기로 나간다. */
const baseClient = createAxiosInstance({ baseURL: API_BASE_URL });

/** 서버 실코드 → 프론트 계약 코드 번역표. TRIP-172 — AGE_REQUIREMENT_NOT_MET 1건, 테스트 없이 이관. */
const SERVER_ERROR_CODE_TRANSLATIONS: Record<string, string> = {
  AGE_REQUIREMENT_NOT_MET: 'AGE_NOT_MET',
};

function translateServerErrorCode(code: string): string {
  return SERVER_ERROR_CODE_TRANSLATIONS[code] ?? code;
}

/** HTTP 상태 → 프론트 에러 코드 매핑(서버 body 에 코드가 없을 때만 쓰는 추측). 403 은 인프라/게이트웨이 폴백 — 실경로는 번역표가 먼저 잡는다. */
function statusToSocialErrorCode(status: number): string {
  switch (status) {
    case 401:
      return 'SOCIAL_AUTH_FAILED';
    case 403:
      return 'AGE_NOT_MET';
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

/** axios 에러 → NormalizedApiError. 서버 body 에 에러코드가 있으면 그걸 번역표를 거쳐 우선 쓰고, 없을 때만 상태 매핑으로 추측한다. 응답 자체가 없으면(네트워크 실패) NETWORK_ERROR. */
function normalizeSocialError(error: unknown): NormalizedApiError {
  if (!isAxiosError(error) || !error.response) {
    return { code: 'NETWORK_ERROR', status: 0, existingProvider: null };
  }
  const { status, data } = error.response;
  const body = data as
    | {
        error?: {
          code?: string;
          existingProvider?: string | null;
          fields?: ErrorResponseErrorFieldsItem[];
        };
      }
    | undefined;
  const bodyCode = body?.error?.code;
  return {
    code: bodyCode
      ? translateServerErrorCode(bodyCode)
      : statusToSocialErrorCode(status),
    status,
    existingProvider: body?.error?.existingProvider ?? null,
    fields: body?.error?.fields,
  };
}

export async function fetchBootstrap(): Promise<BootstrapResponse> {
  const response = await authedClient.get<BootstrapResponse>('/bootstrap');
  return response.data;
}

export async function postSocialLogin(
  provider: SocialProvider,
  body: SocialLoginBody
): Promise<TokenPair> {
  try {
    const response = await baseClient.post<TokenPair>(
      `/auth/social/${provider}`,
      body
    );
    return response.data;
  } catch (error) {
    throw normalizeSocialError(error);
  }
}

/** 네이티브 SDK가 발급한 access token으로 로그인/가입(TRIP-210 · BR-U0-02). code 경로와
 * 에러 집합이 완전히 같아(openapi 실측) normalizeSocialError를 그대로 재사용한다. 로그인 전
 * 호출이라 무인증 baseClient를 탄다(AC-6 · SEC-04). */
export async function postSocialTokenLogin(
  provider: SocialProvider,
  body: SocialTokenLoginBody
): Promise<TokenPair> {
  try {
    const response = await baseClient.post<TokenPair>(
      `/auth/social/${provider}/token`,
      body
    );
    return response.data;
  } catch (error) {
    throw normalizeSocialError(error);
  }
}

/** 저장소의 refresh 토큰으로 회전 요청 → 새 쌍을 저장소·홀더에 반영 → 새 access 반환. */
export async function refreshTokens(): Promise<string> {
  const stored = await getTokens();
  const response = await baseClient.post<TokenPair>('/auth/token/refresh', {
    refreshToken: stored?.refreshToken,
  });
  const { accessToken, refreshToken } = response.data;
  await saveTokens({ accessToken, refreshToken });
  setAccessToken(accessToken);
  return accessToken;
}

export async function fetchTerms(): Promise<TermsVersion[]> {
  const response = await baseClient.get<TermsVersion[]>('/terms');
  return response.data;
}

/** 리프레시 자체의 실패(원인 불문 — 401·네트워크 끊김·5xx 전부) = 세션 만료. 홀더·저장소 둘 다 비운다(BR-U0-09). */
function onSessionExpired(): void {
  clearAccessToken();
  void clearTokens();
}

/** orval mutator(`./mutator.ts`)가 타는 인증 계층 — export는 그 mutator 전용(TRIP-179 D3). */
export const authedClient = createAuthedApiClient({
  baseURL: API_BASE_URL,
  getAccessToken,
  refreshTokens,
  onSessionExpired,
});

export async function submitConsents(consents: ConsentInput[]): Promise<void> {
  await authedClient.post('/me/consents', { consents });
}

/**
 * 단건 약관 동의 상태 변경(PATCH) — 개인화 동의 토글(TRIP-612) 등. `termsType` 은 **URL 경로**에만 들어가고,
 * body 는 `{ action, termsVersion }` 두 필드뿐이다(openapi `PATCH /me/consents/{termsType}`).
 * ⚠️ body 에 `termsType` 을 실으면 계약 위반이다(D5 — `submitConsents` 의 `ConsentInput` 을 재사용하지 않는 이유).
 */
export async function patchConsent(
  termsType: string,
  termsVersion: string,
  action: ConsentAction
): Promise<void> {
  await authedClient.patch(`/me/consents/${termsType}`, {
    action,
    termsVersion,
  });
}

export async function fetchNicknameSuggestions(): Promise<string[]> {
  const response = await authedClient.post<{ suggestions: string[] }>(
    '/nickname/suggestions'
  );
  return response.data.suggestions;
}

export async function checkNickname(
  nickname: string
): Promise<NicknameCheckResult> {
  const response = await authedClient.post<NicknameCheckResult>(
    '/nickname/check',
    { nickname }
  );
  return response.data;
}

export async function updateNickname(nickname: string): Promise<void> {
  await authedClient.patch('/me/profile/nickname', { nickname });
}

export async function completeOnboarding(): Promise<void> {
  await authedClient.post('/onboarding/complete');
}
