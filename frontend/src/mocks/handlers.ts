import { http, HttpResponse } from 'msw';

import type { BootstrapResponse, TokenPair } from '@/shared/api';
import type {
  CreateTripRequest,
  PreferenceView,
  Trip,
} from '@/shared/api/generated/schemas';
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
    termsType: 'LOCATION_TERMS',
    version: '1.1',
    body: '[플레이스홀더] 위치정보 이용약관 본문',
    effectiveAt: '2026-02-15T00:00:00Z',
    reconsentRequired: false,
  },
  {
    termsType: 'MARKETING',
    version: '1.2',
    body: '마케팅 정보 수신 동의 본문',
    effectiveAt: '2026-02-01T00:00:00Z',
    reconsentRequired: false,
  },
  {
    termsType: 'GPS_RECORDING',
    version: '1.0',
    body: '[플레이스홀더] GPS 기록 동의 본문',
    effectiveAt: '2026-02-01T00:00:00Z',
    reconsentRequired: false,
  },
  {
    termsType: 'PERSONALIZATION',
    version: '1.0',
    body: '[플레이스홀더] 개인화 동의 본문',
    effectiveAt: '2026-02-01T00:00:00Z',
    reconsentRequired: false,
  },
];

/** POST /nickname/suggestions 후보 3개 — D6(대체 후보 칩 3개)과 개수를 맞춘다. */
const NICKNAME_SUGGESTIONS = ['여행자1234', '노을수집가', '골목탐험가'];

/**
 * 소셜 로그인 응답 판정 — code 경로(`/auth/social/{provider}`)와 SDK 토큰 경로
 * (`/auth/social/{provider}/token`)가 **완전히 같은 에러 집합**을 쓰므로(openapi 실측: 401·409·
 * 422·429 동일, 200 도 같은 TokenPair) 한 함수를 두 핸들러가 공유한다. 갈라 두면 두 경로의
 * 목 거동이 조용히 어긋나 "code 는 되는데 token 만 안 되는" 가짜 차이를 만든다.
 */
function socialLoginResponse(provider: string, ageConfirmation: unknown) {
  const scenario = getScenario();
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
      if (ageConfirmation) {
        return HttpResponse.json(
          { error: { code: 'AGE_NOT_MET' } },
          { status: 422 }
        );
      }
      return HttpResponse.json(tokenPair(true, provider));
    case 'new-user':
      // TRIP-248 — 실서버는 신규 가입 첫 요청(연령확인 미동봉)을 400 으로 거절한다
      // (AuthenticateWithSocialUseCase.kt:76-77). 200 을 돌려주던 이전 목은 도달 불가 분기를
      // 흉내내고 있었다. reason 문자열은 백엔드 원문 그대로다(발명 금지).
      if (ageConfirmation) {
        return HttpResponse.json(tokenPair(true, provider));
      }
      return HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            fields: [
              {
                field: 'ageConfirmation',
                reason: '신규 가입 시 연령확인이 필요합니다',
              },
            ],
          },
        },
        { status: 400 }
      );
    case 'existing-user':
    default:
      return HttpResponse.json(tokenPair(false, provider));
  }
}

/**
 * TRIP-203 AC-8 — `Trip.required` 10필드를 갖춘 응답(상상해서 만들지 않는다). 요청 바디의
 * 필수 3필드는 그대로 반영하고, 나머지 선택 필드는 openapi 기본값·null로 채운다.
 */
function tripFixture(body: CreateTripRequest): Trip {
  return {
    tripId: '00000000-0000-0000-0000-000000000001',
    title: body.title ?? '제주 여행',
    startDate: body.startDate,
    endDate: body.endDate,
    party: body.party ?? 1,
    companionType: body.companionType ?? null,
    budgetTotal: body.budgetTotal ?? null,
    preferenceSnapshot: {},
    destinations: body.destinations,
    status: 'PLANNED',
    createdAt: '2026-08-02T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
  };
}

/** TRIP-203 AC-8 — `PreferenceView` 7축 밖을 발명하지 않는다. 예산 러프값(rawAmount)은
 * 숫자로, isNeutralDefault 는 불리언으로 준다(AC-5 가 소비하는 모양). */
function preferenceViewFixture(): PreferenceView {
  return {
    pace: { value: '균형있게', isNeutralDefault: false },
    budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  };
}

export const handlers = [
  http.get(`${BASE}/bootstrap`, () =>
    HttpResponse.json(bootstrapBody(getScenario()))
  ),

  /**
   * TRIP-210 — 네이티브 SDK access token 경로. **별도 핸들러가 반드시 필요하다**: 아래
   * `/auth/social/:provider` 의 `:provider` 는 경로 세그먼트 **하나**만 매치하므로
   * `/auth/social/kakao/token` 을 잡지 못한다(실측). 통합 버킷은
   * `onUnhandledRequest:'error'` 로 돌기 때문에 핸들러가 없으면 테스트가 AC 실패가 아니라
   * `InternalError: Cannot bypass a request when using the "error" strategy` 로 **준비
   * 단계에서 죽는다** — 증상이 원인을 안 가리킨다.
   */
  http.post(
    `${BASE}/auth/social/:provider/token`,
    async ({ params, request }) => {
      const body = (await request.json().catch(() => ({}))) as {
        ageConfirmation?: unknown;
      };
      return socialLoginResponse(String(params.provider), body.ageConfirmation);
    }
  ),

  http.post(`${BASE}/auth/social/:provider`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      ageConfirmation?: unknown;
    };
    return socialLoginResponse(String(params.provider), body.ageConfirmation);
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

  // ── TRIP-203 여행 생성·취향 조회 (AC-8) ──────────────────────────────
  http.post(`${BASE}/trips`, async ({ request }) => {
    const body = (await request.json()) as CreateTripRequest;
    return HttpResponse.json(tripFixture(body), { status: 201 });
  }),

  http.get(`${BASE}/me/preferences`, () =>
    HttpResponse.json(preferenceViewFixture())
  ),

  /**
   * TRIP-208 등록 숙소 날짜 연계 — 리포 최초의 `GET /saved-stays` 목이다.
   *
   * **기본값이 빈 목록인 이유**: 이 핸들러가 필요한 첫 번째 이유는 AC 심판이 아니라
   * `TripNewStep1Page.integration.test.tsx`(승인 동결분)를 **살려 두는 것**이다. 그 버킷은
   * `onUnhandledRequest: 'error'`로 돌기 때문에, 위저드 페이지가 이 경로를 부르는 순간
   * 핸들러가 없으면 그 파일이 AC 실패가 아니라 **준비 단계에서 죽는다**. 빈 계정이 가장
   * 무해한 기본값이고(대안 UI만 그려진다), 얼굴별 응답이 필요한 테스트는 `server.use(...)`로
   * 각자 덮어쓴다(`TripNewStep1Page.stayImport.integration.test.tsx`).
   */
  http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
];
