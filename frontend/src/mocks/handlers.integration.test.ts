import axios from 'axios';

import {
  fetchBootstrap,
  postSocialLogin,
  postSocialTokenLogin,
} from '@/shared/api';
import { server } from './server';
import { resetScenario, setScenario } from './scenarios';

/**
 * AC-W-11 · MSW 핸들러 자체 계약(오라클 정합성) 검증.
 *
 * 이 스위트는 "가짜 서버가 openapi 계약대로 응답하는가"를 확인한다 — 배선(컨테이너/게이트)이 아니라
 * 테스트 인프라(MSW 오라클) 자기검증이라, 소스가 이미 있어 **green-by-construction** 이다(§매핑표에 명시).
 * 동시에 이 스위트가 green 이면 "msw/node 가 이 RN jest 환경에서 실제 axios 를 가로챈다"가 증명된다(R1 카나리).
 *
 * 3동작: 준비(시나리오 set) → 실행(실 fetchBootstrap/postSocialLogin 호출) → 단언(응답 shape).
 */

const REFRESH_URL = 'http://localhost:8080/api/v1/auth/token/refresh';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetScenario();
});
afterAll(() => server.close());

const authorizeBody = {
  authorizationCode: 'code-abc',
  codeVerifier: 'verifier-xyz',
  redirectUri: 'trippilot://oauth/google',
};

describe('MSW /bootstrap 핸들러 — 시나리오별 부트스트랩 응답', () => {
  it('guest 시나리오는 session.state=GUEST 를 낸다', async () => {
    setScenario('login-cancel'); // bootstrap: guest
    const res = await fetchBootstrap();
    expect(res.session.state).toBe('GUEST');
  });

  it('force-update 시나리오는 appUpdate.status=FORCED 를 낸다', async () => {
    setScenario('bootstrap-force-update');
    const res = await fetchBootstrap();
    expect(res.appUpdate.status).toBe('FORCED');
  });

  it('reconsent 시나리오는 reconsent.required=true 를 낸다', async () => {
    setScenario('bootstrap-reconsent');
    const res = await fetchBootstrap();
    expect(res.reconsent.required).toBe(true);
  });

  it('onboarding 시나리오는 session.state=ONBOARDING_INCOMPLETE 를 낸다', async () => {
    setScenario('login-success-new'); // bootstrap: onboarding
    const res = await fetchBootstrap();
    expect(res.session.state).toBe('ONBOARDING_INCOMPLETE');
  });
});

describe('MSW /auth/social/{provider} 핸들러 — 신규/기존/에러', () => {
  it('existing-user 는 TokenPair(isNewUser=false) 를 낸다', async () => {
    setScenario('login-success-existing');
    const tokens = await postSocialLogin('google', authorizeBody);
    expect(tokens.isNewUser).toBe(false);
    expect(tokens.accessToken).toEqual(expect.any(String));
    expect(tokens.refreshToken).toEqual(expect.any(String));
  });

  it('new-user 는 TokenPair(isNewUser=true) 를 낸다', async () => {
    setScenario('login-success-new');
    const tokens = await postSocialLogin('google', authorizeBody);
    expect(tokens.isNewUser).toBe(true);
  });

  it('auth-failed 는 401 → NormalizedApiError(SOCIAL_AUTH_FAILED) 로 정규화된다', async () => {
    setScenario('login-error-auth');
    await expect(
      postSocialLogin('google', authorizeBody)
    ).rejects.toMatchObject({ code: 'SOCIAL_AUTH_FAILED', status: 401 });
  });

  it('email-conflict 는 409 + existingProvider(코드) 를 정규화한다', async () => {
    setScenario('login-email-conflict');
    await expect(
      postSocialLogin('google', authorizeBody)
    ).rejects.toMatchObject({
      code: 'SOCIAL_EMAIL_CONFLICT',
      status: 409,
      existingProvider: 'kakao',
    });
  });

  it('rate-limited 는 429(RATE_LIMITED) 로 정규화된다', async () => {
    setScenario('login-rate-limited');
    await expect(
      postSocialLogin('google', authorizeBody)
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });

  it('age-restricted 는 연령확인 재전송(ageConfirmation)에만 422(AGE_NOT_MET) 를 낸다', async () => {
    setScenario('login-age-restricted');
    // 1차(연령확인 없음)는 신규 판정으로 통과
    const first = await postSocialLogin('google', authorizeBody);
    expect(first.isNewUser).toBe(true);
    // 2차(연령확인 동봉)는 422
    await expect(
      postSocialLogin('google', {
        ...authorizeBody,
        ageConfirmation: { method: 'SELF_DECLARED' },
      })
    ).rejects.toMatchObject({ code: 'AGE_NOT_MET', status: 422 });
  });
});

describe('MSW /auth/social/{provider}/token 핸들러 — 실패 응답 정규화 (TRIP-210)', () => {
  /**
   * code-critic 뮤테이션 D: `postSocialTokenLogin` 의 `throw normalizeSocialError(error)` 를
   * `throw error` 로 바꿔도 621+80 전부 green 이었다. 원인은 **성공 경로만 심판이 있었다**는 것 —
   * 훅 테스트는 `@/shared/api` 를 통째로 목 처리해 함수 본체가 사각지대이고, 통합 테스트의
   * 새 케이스 2개는 둘 다 성공 응답만 다뤘다.
   *
   * 정규화가 빠지면 axios 원본 에러가 그대로 훅에 닿는다. axios 에러에도 `.code` 가 있지만
   * 값은 `'ERR_BAD_REQUEST'` 라, 화면의 `errorCode === 'SOCIAL_EMAIL_CONFLICT'` 분기가 안 걸려
   * **계정 연결 안내가 영영 안 뜬다**(같은 방식으로 만 14세 확인 화면도 사라진다).
   *
   * 위 code 경로(`/auth/social/{provider}`)의 같은 성질 테스트와 **같은 형태**로 세운다.
   */
  it('email-conflict 는 409 + existingProvider 를 code 경로와 똑같이 정규화한다', async () => {
    setScenario('login-email-conflict');

    // status·existingProvider 까지 보는 것이 핵심 — 원본 axios 에러에는 이 둘이 없다.
    await expect(
      postSocialTokenLogin('kakao', { accessToken: 'kakao-access-token' })
    ).rejects.toMatchObject({
      code: 'SOCIAL_EMAIL_CONFLICT',
      status: 409,
      existingProvider: 'kakao',
    });
  });

  it('auth-failed 는 401 → NormalizedApiError(SOCIAL_AUTH_FAILED) 로 정규화된다', async () => {
    setScenario('login-error-auth');
    await expect(
      postSocialTokenLogin('naver', { accessToken: 'naver-access-token' })
    ).rejects.toMatchObject({ code: 'SOCIAL_AUTH_FAILED', status: 401 });
  });
});

describe('MSW /auth/token/refresh 핸들러 (D5 — mock 만, 실배선은 겹2)', () => {
  it('refresh 는 새 TokenPair 를 낸다', async () => {
    const res = await axios.post(REFRESH_URL, { refreshToken: 'old-refresh' });
    expect(res.data).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
  });
});
