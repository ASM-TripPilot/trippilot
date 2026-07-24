import { server } from '@/mocks/server';
import { saveTokens } from '@/shared/storage';
import {
  setOnboardingScenario,
  resetOnboardingScenario,
} from '@/test-support/onboardingScenarios';
import {
  checkNickname,
  completeOnboarding,
  fetchBootstrap,
  fetchNicknameSuggestions,
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
