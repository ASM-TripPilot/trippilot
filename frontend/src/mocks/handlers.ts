import { http, HttpResponse } from 'msw';

import type { BootstrapResponse, TokenPair } from '@/shared/api';
import { getScenario, type MockScenario } from './scenarios';

/**
 * MSW 핸들러(테스트 인프라 + dev 런타임 공유). 백엔드 없이 openapi 계약 shape 그대로 응답한다.
 * 응답 내용은 활성 시나리오(getScenario)로 결정 → 테스트/스위처가 setScenario 로 갈아끼운다.
 *
 * *(개념)* MSW `http.get/post`: 지정 URL 로 나가는 요청을 가로채는 핸들러. `HttpResponse.json(body, {status})`
 * 로 가짜 응답을 만든다. axios 코드는 그대로 두고 네트워크 계층에서만 응답을 바꾼다.
 */

const BASE = `${
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
}/api/v1`;

function tokenPair(isNewUser: boolean, provider: string): TokenPair {
  return {
    accessToken: `mock-access-${provider}`,
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshToken: `mock-refresh-${provider}`,
    refreshExpiresIn: 7776000,
    isNewUser,
    account: {
      accountId: '00000000-0000-0000-0000-000000000001',
      status: 'ACTIVE',
      email: null,
      socialProviders: [provider.toUpperCase()],
      onboardingCompleted: !isNewUser,
    },
  };
}

function bootstrapBody(scenario: MockScenario): BootstrapResponse {
  const base: BootstrapResponse = {
    appUpdate: { status: 'NONE', minSupportedVersion: '1.0.0' },
    reconsent: { required: false, termsTypes: [] },
    session: { state: 'GUEST', onboardingCompleted: false },
  };
  switch (scenario.bootstrap) {
    case 'force-update':
      return {
        ...base,
        appUpdate: { status: 'FORCED', minSupportedVersion: '2.0.0' },
      };
    case 'reconsent':
      return {
        ...base,
        reconsent: { required: true, termsTypes: ['TOS', 'PRIVACY'] },
        session: { state: 'AUTHENTICATED', onboardingCompleted: true },
      };
    case 'onboarding':
      return {
        ...base,
        session: { state: 'ONBOARDING_INCOMPLETE', onboardingCompleted: false },
      };
    case 'authenticated':
      return {
        ...base,
        session: { state: 'AUTHENTICATED', onboardingCompleted: true },
      };
    case 'guest':
    default:
      return base;
  }
}

export const handlers = [
  http.get(`${BASE}/bootstrap`, () =>
    HttpResponse.json(bootstrapBody(getScenario()))
  ),

  http.post(`${BASE}/auth/social/:provider`, async ({ params, request }) => {
    const scenario = getScenario();
    const provider = String(params.provider);
    const body = (await request.json().catch(() => ({}))) as {
      ageConfirmation?: unknown;
    };

    switch (scenario.social) {
      case 'auth-failed':
        return HttpResponse.json(
          { error: { code: 'SOCIAL_AUTH_FAILED' } },
          { status: 401 }
        );
      case 'rate-limited':
        return HttpResponse.json(
          { error: { code: 'RATE_LIMITED' } },
          { status: 429 }
        );
      case 'email-conflict':
        return HttpResponse.json(
          {
            error: {
              code: 'SOCIAL_EMAIL_CONFLICT',
              existingProvider: scenario.existingProvider,
            },
          },
          { status: 409 }
        );
      case 'age-restricted':
        if (body.ageConfirmation) {
          return HttpResponse.json(
            { error: { code: 'AGE_NOT_MET' } },
            { status: 422 }
          );
        }
        return HttpResponse.json(tokenPair(true, provider));
      case 'new-user':
        return HttpResponse.json(tokenPair(true, provider));
      case 'existing-user':
      default:
        return HttpResponse.json(tokenPair(false, provider));
    }
  }),

  http.post(`${BASE}/auth/token/refresh`, () =>
    HttpResponse.json(tokenPair(false, 'refresh'))
  ),
];
