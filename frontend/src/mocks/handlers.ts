import { http, HttpResponse } from 'msw';

import type { BootstrapResponse, TokenPair } from '@/shared/api';
import { getOnboardingScenario } from '@/test-support/onboardingScenarios';
import { getScenario, type MockScenario } from './scenarios';

/**
 * MSW 핸들러(테스트 오라클 전용 — 앱 번들 밖). 백엔드 없이 openapi 계약 shape 그대로 응답한다.
 * 로그인·부트스트랩 응답은 `./scenarios`(getScenario), 온보딩 응답은 **테스트 전용 모듈**
 * `@/test-support/onboardingScenarios`(getOnboardingScenario)로 결정한다 — 온보딩 목 거동을
 * `./scenarios` 에 얹지 않는 이유는 그 모듈이 프로덕션 코드에서 참조돼 앱 정적 그래프 안에 있기 때문이다.
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

/**
 * TRIP-162 온보딩 계약 shape — openapi.yaml 의 TermsVersion / ConsentSubmission /
 * nickname 계열 스키마를 그대로 옮긴 것이다(임의 발명 금지).
 */
interface TermsVersionBody {
  termsType: string;
  version: string;
  body: string;
  effectiveAt: string;
  reconsentRequired: boolean;
}

/**
 * 버전 문자열을 항목마다 **일부러 다르게** 둔다 — A7 이 "서버가 준 버전을 그대로 되돌려 보내는가"를
 * 검사하기 때문이다. 전부 '1.0' 이면 클라가 하드코딩해도 테스트가 통과해 버린다(BR-U0-12).
 */
const TERMS_VERSIONS: TermsVersionBody[] = [
  {
    termsType: 'TERMS_OF_SERVICE',
    version: '1.4',
    body: '서비스 이용약관 본문',
    effectiveAt: '2026-01-01T00:00:00Z',
    reconsentRequired: false,
  },
  {
    termsType: 'PRIVACY_POLICY',
    version: '2.1',
    body: '개인정보 처리방침 본문',
    effectiveAt: '2026-03-01T00:00:00Z',
    reconsentRequired: false,
  },
  {
    termsType: 'MARKETING',
    version: '1.2',
    body: '마케팅 정보 수신 동의 본문',
    effectiveAt: '2026-02-01T00:00:00Z',
    reconsentRequired: false,
  },
];

/** POST /nickname/suggestions 후보 3개 — D6(대체 후보 칩 3개)과 개수를 맞춘다. */
const NICKNAME_SUGGESTIONS = ['여행자1234', '노을수집가', '골목탐험가'];

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

  // ── TRIP-162 온보딩 ────────────────────────────────────────────────
  http.get(`${BASE}/terms`, () => HttpResponse.json(TERMS_VERSIONS)),

  http.post(`${BASE}/me/consents`, () => {
    if (getOnboardingScenario().consent === 'server-error') {
      return HttpResponse.json(
        { error: { code: 'INTERNAL_ERROR' } },
        { status: 500 }
      );
    }
    return new HttpResponse(null, { status: 200 });
  }),

  http.post(`${BASE}/nickname/suggestions`, () =>
    HttpResponse.json({ suggestions: NICKNAME_SUGGESTIONS })
  ),

  // 금칙어·중복 판정은 **서버만** 한다 — 클라는 이 응답을 받아 표시할 뿐이다.
  // 어떤 금칙어에 걸렸는지(매칭 원문)는 응답에 담지 않는다(openapi summary 명시).
  http.post(`${BASE}/nickname/check`, () => {
    switch (getOnboardingScenario().nickname) {
      case 'taken':
        return HttpResponse.json({ available: false, reason: 'TAKEN' });
      case 'banned-word':
        return HttpResponse.json({ available: false, reason: 'BANNED_WORD' });
      default:
        return HttpResponse.json({ available: true, reason: 'OK' });
    }
  }),

  http.patch(`${BASE}/me/profile/nickname`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      nickname?: string;
    };
    switch (getOnboardingScenario().nickname) {
      case 'taken':
        return HttpResponse.json(
          { error: { code: 'NICKNAME_TAKEN' } },
          { status: 409 }
        );
      case 'save-failed':
        return HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR' } },
          { status: 500 }
        );
      default:
        return HttpResponse.json({
          nickname: body.nickname ?? '',
          nicknameUpdatedAt: '2026-07-21T00:00:00Z',
          onboardingCompletedAt: null,
        });
    }
  }),

  http.post(`${BASE}/onboarding/complete`, () =>
    HttpResponse.json({ onboardingCompletedAt: '2026-07-21T00:00:00Z' })
  ),
];
