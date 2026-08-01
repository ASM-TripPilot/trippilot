import { http, HttpResponse } from 'msw';

import { server } from '@/mocks/server';
import { clearTokens, saveTokens } from '@/shared/storage';
import {
  setOnboardingScenario,
  resetOnboardingScenario,
} from '@/test-support/onboardingScenarios';
import {
  checkNickname,
  completeOnboarding,
  fetchBootstrap,
  fetchNicknameSuggestions,
  fetchTerms,
  postSocialLogin,
  postSocialTokenLogin,
  refreshTokens,
  submitConsents,
  updateNickname,
} from '.';
import {
  clearAccessToken,
  getAccessToken,
  hydrate,
  setAccessToken,
} from './tokenManager';

/**
 * T1-1 · T1-2 · T1-5 — 온보딩 API 인증 헤더 배선(계약 수준 통합테스트).
 *
 * 무엇을 보장하나: 온보딩 래퍼들이 실제로 axios→MSW 경로를 타고 나갈 때,
 *  (1) 토큰 홀더에 access 가 있으면 인증 필요 5종이 `Authorization: Bearer <token>` 를 싣고(T1-1),
 *  (2) 토큰이 없으면 헤더 자체를 붙이지 않으며(T1-2, 빈 'Bearer ' 금지),
 *  (3) refreshTokens 가 POST /auth/token/refresh 를 때려 회전된 토큰을 저장·반환한다(T1-5).
 *
 * 왜 통합 버킷인가: "래퍼가 인증 클라이언트를 통과하는가"는 래퍼+클라이언트+홀더의 합작이라
 * MSW 가 받은 실제 outgoing 헤더로 봐야 충실하다. 서버 판정 권위(백엔드)는 유효 JWT 가 있어야
 * 실검증되므로(D4 후속) 여기선 MSW 오라클로 계약 수준까지 잠근다.
 *
 * *(개념)* MSW `server.events.on('request:start')`: 나가는 요청마다 한 번씩 불리는 관찰 훅 —
 * 요청을 바꾸지 않고 헤더/URL 만 들여다볼 때 쓴다. 여기선 경로별 Authorization 값을 모은다.
 *
 * refreshTokens 는 refresh 토큰을 저장소에서 읽고 회전 결과를 다시 저장하므로 secure-store 를 목킹한다.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

/** 경로 → 그 요청이 실었던 Authorization 헤더(없으면 null). 키의 존재 = 그 엔드포인트를 때렸다는 뜻. */
const authByPath: Record<string, string | null> = {};

/** TermsPage.integration.test.tsx:64 와 같은 값(리포 관례) — MSW 핸들러 덮어쓰기에 쓴다. */
const BASE = 'http://localhost:8080/api/v1';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    authByPath[new URL(request.url).pathname] =
      request.headers.get('authorization');
  });
});

beforeEach(() => {
  setOnboardingScenario('onboarding-happy');
  for (const key of Object.keys(authByPath)) {
    delete authByPath[key];
  }
  clearAccessToken();
  (saveTokens as jest.Mock).mockClear();
});

afterEach(() => {
  server.resetHandlers();
  resetOnboardingScenario();
});

afterAll(() => server.close());

describe('온보딩 인증 헤더 부착 (T1-1)', () => {
  it('홀더에 토큰이 있으면 인증 필요 5종이 Authorization: Bearer <token> 를 싣는다', async () => {
    // 준비 — 로그인으로 홀더가 채워진 상태.
    setAccessToken('valid-access');

    // 실행 — 인증 필요 온보딩 호출 5종을 실제로 내보낸다.
    await Promise.all([
      submitConsents([
        { termsType: 'TERMS_OF_SERVICE', termsVersion: '1.4', action: 'GRANT' },
      ]),
      fetchNicknameSuggestions(),
      checkNickname('여행자1234'),
      updateNickname('여행자1234'),
      completeOnboarding(),
    ]);

    // 단언 — 다섯 요청 모두 같은 Bearer 토큰을 실어 서버 인증 경계를 통과한다.
    expect(authByPath['/api/v1/me/consents']).toBe('Bearer valid-access');
    expect(authByPath['/api/v1/nickname/suggestions']).toBe(
      'Bearer valid-access'
    );
    expect(authByPath['/api/v1/nickname/check']).toBe('Bearer valid-access');
    expect(authByPath['/api/v1/me/profile/nickname']).toBe(
      'Bearer valid-access'
    );
    expect(authByPath['/api/v1/onboarding/complete']).toBe(
      'Bearer valid-access'
    );
  });
});

describe('무토큰 시 헤더 미부착 (T1-2)', () => {
  it('토큰이 없으면 Authorization 을 붙이지 않는다 — 있을 때와 대조(공허한 통과 방지)', async () => {
    // 대조(긍정) — 토큰이 있으면 헤더가 실린다. red 에서 여기서 먼저 실패한다.
    setAccessToken('valid-access');
    await completeOnboarding();
    expect(authByPath['/api/v1/onboarding/complete']).toBe(
      'Bearer valid-access'
    );

    // 실행 — 홀더를 비운다(게스트/미로그인).
    clearAccessToken();
    delete authByPath['/api/v1/onboarding/complete'];
    await completeOnboarding();

    // 단언(부정) — 토큰이 없으면 헤더 자체가 없어야 한다(빈 'Bearer ' 도 금지).
    expect(authByPath['/api/v1/onboarding/complete']).toBeNull();
  });
});

describe('리프레시 래퍼 계약 (T1-5)', () => {
  it('refreshTokens 가 POST /auth/token/refresh 를 호출하고 회전된 토큰을 저장·반환한다', async () => {
    // 실행 — 리프레시 1회.
    const newAccess = await refreshTokens();

    // 단언 — 새 access 토큰을 반환한다(MSW tokenPair refresh).
    expect(newAccess).toBe('mock-access-refresh');
    // 회전된 access/refresh 쌍을 secure-store 에 저장한다(다음 리프레시의 씨앗).
    expect(saveTokens).toHaveBeenCalledWith({
      accessToken: 'mock-access-refresh',
      refreshToken: 'mock-refresh-refresh',
    });
    // 홀더에도 새 access 를 실어, 재시도되는 원 요청이 곧바로 새 토큰을 쓴다.
    expect(getAccessToken()).toBe('mock-access-refresh');
    // 실제로 리프레시 엔드포인트를 때렸다(키 존재 = 호출됨).
    expect(authByPath).toHaveProperty('/api/v1/auth/token/refresh');
  });
});

describe('부트스트랩 인증 헤더 (AC-S1 · 결함 A-2 · 케이스 31)', () => {
  it('토큰이 있으면 Bearer 를 싣고, 없으면 헤더 자체를 붙이지 않는다', async () => {
    // 준비 + 실행(긍정) — 홀더에 access 토큰이 있는 상태에서 부트스트랩을 부른다.
    setAccessToken('valid-access');
    await fetchBootstrap();

    // 단언(긍정) — 지금은 fetchBootstrap 이 무인증 baseClient 를 써서 헤더가 없어 실패한다.
    expect(authByPath['/api/v1/bootstrap']).toBe('Bearer valid-access');

    // 실행(부정) — 홀더를 비우고 다시 부른다(대조 · 공허한 통과 방지).
    clearAccessToken();
    delete authByPath['/api/v1/bootstrap'];
    await fetchBootstrap();

    // 단언(부정) — 토큰이 없으면 헤더 자체가 없어야 한다(빈 'Bearer ' 도 금지).
    expect(authByPath['/api/v1/bootstrap']).toBeNull();
  });
});

describe('복원 직후 첫 부트스트랩 (AC-S3 · 결함 D · 케이스 32)', () => {
  it('hydrate 로 복원한 토큰이 첫 부트스트랩부터 Bearer 로 실리고 리프레시를 타지 않는다', async () => {
    // 준비 — 콜드 재시작을 흉내낸다: 홀더를 비운 뒤 저장소 복원 값을 hydrate 로 싣는다.
    clearAccessToken();
    hydrate('stored-access');

    // 실행 — 복원 직후 첫 요청.
    await fetchBootstrap();

    // 단언 — 재시작 후 첫 요청부터 인증 상태다(401→리프레시 왕복이 매 부팅마다 없다).
    expect(authByPath['/api/v1/bootstrap']).toBe('Bearer stored-access');
    // 리프레시 엔드포인트는 아예 때리지 않았다(키 자체가 없다).
    expect(authByPath).not.toHaveProperty('/api/v1/auth/token/refresh');
  });
});

describe('무인증 엔드포인트 배분 (C2·C3·C4 · SEC-04)', () => {
  it('홀더에 토큰이 있어도 소셜 로그인·토큰 갱신·약관 조회는 Authorization 없이 나간다', async () => {
    // 준비 — 홀더를 채운다(대조군용). MSW 시나리오는 이 파일의 기본값(login-success-existing)을
    // 그대로 쓴다 — 이 파일에 setScenario 를 도입하지 마라. 도입하면 postSocialLogin 이 200 을
    // 못 받아 이 케이스가 준비 단계에서 조용히 깨진다.
    setAccessToken('valid-access');

    // 실행 — 대조군(인증) 먼저, 그다음 무인증 3종을 순차로. refreshTokens 는 홀더를 새 access 로
    // 덮어쓰므로 반드시 마지막에 부른다.
    await completeOnboarding();
    await postSocialLogin('google', {
      authorizationCode: 'code-abc',
      codeVerifier: 'verifier-xyz',
      redirectUri: 'trippilot://oauth/google',
    });
    await fetchTerms();
    await refreshTokens();

    // 단언 — 대조군은 Bearer 를 싣는다(홀더가 실제로 차 있다는 증명, 이게 없으면 아래 3개가
    // 가짜 통과다). 무인증 3종은 toBeNull — 요청이 나갔고(≠undefined) 헤더가 없다는 뜻이다.
    expect(authByPath['/api/v1/onboarding/complete']).toBe(
      'Bearer valid-access'
    );
    expect(authByPath['/api/v1/auth/social/google']).toBeNull();
    expect(authByPath['/api/v1/terms']).toBeNull();
    expect(authByPath['/api/v1/auth/token/refresh']).toBeNull();
  });
});

describe('AC-6 · SDK 토큰 경로도 무인증으로 나간다 (openapi security: [] · SEC-04)', () => {
  it('홀더에 토큰이 있어도 /auth/social/{provider}/token 은 Authorization 없이 나간다', async () => {
    // 준비 — 홀더를 채운다(대조군용). 로그인 **전** 호출이므로 토큰이 있더라도 실리면 안 된다.
    setAccessToken('valid-access');

    // 실행 — 대조군(인증 필요) 먼저, 그다음 토큰 경로 2종.
    await completeOnboarding();
    await postSocialTokenLogin('kakao', { accessToken: 'kakao-access-token' });
    await postSocialTokenLogin('naver', { accessToken: 'naver-access-token' });

    // 단언 — 대조군은 Bearer 를 싣는다(홀더가 실제로 차 있다는 증명. 이게 없으면 아래 둘이
    // "요청이 안 나가서 통과"하는 가짜 통과다).
    expect(authByPath['/api/v1/onboarding/complete']).toBe(
      'Bearer valid-access'
    );
    // toBeNull = 요청이 나갔고(≠undefined) 헤더가 없다는 뜻. 빈 'Bearer ' 도 실패한다.
    expect(authByPath['/api/v1/auth/social/kakao/token']).toBeNull();
    expect(authByPath['/api/v1/auth/social/naver/token']).toBeNull();
  });
});

describe('AC-1·AC-2 (배선) · 실제로 나가는 본문은 accessToken 하나뿐이다', () => {
  it('요청 본문에 accessToken 만 담기고 code 경로 필드·deviceId 는 실리지 않는다', async () => {
    // 준비 — 본문을 캡처하는 핸들러로 덮어쓴다(afterEach 의 resetHandlers 가 원복한다).
    // 훅·API 래퍼 층의 목 단언과 달리, 여기서는 **직렬화되어 실제로 나간 JSON** 을 본다.
    let capturedBody: unknown = null;
    let capturedProvider: string | null = null;
    server.use(
      http.post(
        `${BASE}/auth/social/:provider/token`,
        async ({ params, request }) => {
          capturedProvider = String(params.provider);
          capturedBody = await request.json();
          return HttpResponse.json({
            accessToken: 'server-access',
            tokenType: 'Bearer',
            expiresIn: 3600,
            refreshToken: 'server-refresh',
            refreshExpiresIn: 7776000,
            isNewUser: false,
            account: {
              accountId: '00000000-0000-0000-0000-000000000001',
              status: 'ACTIVE',
              email: null,
              socialProviders: ['KAKAO'],
              onboardingCompleted: true,
            },
          });
        }
      )
    );

    // 실행
    await postSocialTokenLogin('kakao', { accessToken: 'wire-access-token' });

    // 단언 — 완전 일치. authorizationCode·codeVerifier·redirectUri 가 섞여 들어가거나
    // deviceId(D7: 미전송)가 붙으면 실패한다.
    expect(capturedProvider).toBe('kakao');
    expect(capturedBody).toEqual({ accessToken: 'wire-access-token' });
  });
});

describe('세션 만료 시 토큰 파기 (E1·E2 · BR-U0-09)', () => {
  it('리프레시가 401로 실패하면 홀더와 저장소를 둘 다 비운다 (단일 요청 = 정확히 1회)', async () => {
    // 준비 — 홀더에 죽은 토큰을 심고, bootstrap·refresh 둘 다 401 로 응답하도록 핸들러를
    // 덮어쓴다. 이 덮어쓰기는 기존 afterEach 의 server.resetHandlers() 가 자동으로 원복한다.
    setAccessToken('stale-access');
    (clearTokens as jest.Mock).mockClear();
    server.use(
      http.get(`${BASE}/bootstrap`, () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
      ),
      http.post(`${BASE}/auth/token/refresh`, () =>
        HttpResponse.json(
          { error: { code: 'REFRESH_REUSED' } },
          { status: 401 }
        )
      )
    );

    // 실행 — fetchBootstrap 은 인증 클라이언트를 타므로 401 → 리프레시 → 리프레시 실패 →
    // 진짜 onSessionExpired 가 발화한다(export 없이, 두 흔적으로만 관측한다).
    await expect(fetchBootstrap()).rejects.toBeTruthy();

    // 단언 — 홀더(E1)와 저장소(E2) 둘 다 비워졌다. 단일 요청 시나리오라 clearTokens 는
    // 정확히 1회(Seed AC-1). 동시 요청 시나리오였다면 이 횟수는 단언하지 않는다.
    expect(getAccessToken()).toBeNull();
    expect(clearTokens).toHaveBeenCalledTimes(1);
  });

  it('리프레시가 네트워크 실패(응답 자체 없음)로 죽어도 같은 파기가 일어난다 (원인 무관)', async () => {
    // 준비 — 케이스 위와 동일하되 refresh 핸들러만 HttpResponse.error() 로 바꾼다 — 상태코드
    // 500 이 아니라 응답 자체가 없는 네트워크 실패다(axios 의 error.response 가 undefined 가 된다).
    // Seed 확정 경계동작 #1: 세션 만료의 정의는 "리프레시 자체의 실패"이며 원인은 묻지 않는다 —
    // 이 케이스는 그 "현행 보존"을 동결한다. ⚠️ 네트워크 끊김만으로 로그아웃되는 UX 문제는
    // 실재하지만 이번 슬라이스의 범위 밖이다(후속 티켓 후보). 세션 만료를 401/403 으로 좁히는
    // 티켓이 오면 이 케이스는 의도적으로 고쳐야 한다 — 지금은 현행이 이렇다는 것만 잠근다.
    setAccessToken('stale-access');
    (clearTokens as jest.Mock).mockClear();
    server.use(
      http.get(`${BASE}/bootstrap`, () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
      ),
      http.post(`${BASE}/auth/token/refresh`, () => HttpResponse.error())
    );

    // 실행
    await expect(fetchBootstrap()).rejects.toBeTruthy();

    // 단언 — 케이스 위와 동일: 원인이 달라도 결과(파기)는 같다.
    expect(getAccessToken()).toBeNull();
    expect(clearTokens).toHaveBeenCalledTimes(1);
  });
});
