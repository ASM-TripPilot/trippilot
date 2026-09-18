import { makeAuthorize } from './makeAuthorize';

/**
 * AC-W-08 · AC-W-12 · makeAuthorize — dev fake provider 팩토리(OAuth DI 씨앗).
 *
 * 무엇을 보장하나: 컨테이너가 `signIn(provider, makeAuthorize(provider))` 로 주입하는 `authorize` 가
 *  (1) env 토글 `EXPO_PUBLIC_AUTH_FAKE` 가 켜졌을 때만 가짜 인가 결과를 내고,
 *  (2) 성공 결과에는 codeVerifier 만 담기고 어떤 시크릿도 없으며(PKCE·시크릿 비노출),
 *  (3) **env 로 지정한 결과**에 따라 success/cancel/dismiss 를 내고 미지정이면 success 이며,
 *  (4) 토글이 꺼진 실 빌드 경로에서는 가짜 성공을 내지 않는다(dev 전용).
 *
 * **계약 변경(게이트①-2)**: 이전 판은 결과를 `@/mocks/scenarios` 의 활성 시나리오에서 읽었다.
 * 그 한 필드 때문에 207줄 목 모듈이 앱 정적 그래프에 실렸다(반려 사유). 이제 결과의 출처는
 * **env `EXPO_PUBLIC_AUTH_FAKE_OUTCOME`** 이며 이 파일은 `@/mocks/*` 를 전혀 참조하지 않는다.
 * 그 계약은 `src/__tests__/noMswInStaticGraph.test.ts` 가 기계적으로 강제한다.
 *
 * 3동작: 준비(env 설정) → 실행(makeAuthorize(provider)() 호출) → 단언(AuthorizeResult).
 */

const ORIGINAL_FAKE = process.env.EXPO_PUBLIC_AUTH_FAKE;
const ORIGINAL_OUTCOME = process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME;

afterEach(() => {
  process.env.EXPO_PUBLIC_AUTH_FAKE = ORIGINAL_FAKE;
  process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME = ORIGINAL_OUTCOME;
});

describe('makeAuthorize — fake 토글 ON (dev)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '1';
    delete process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME;
  });

  it('결과 지정이 없으면 authorizationCode·codeVerifier·provider별 redirectUri 를 담은 success-code 를 낸다', async () => {
    const result = await makeAuthorize('google')();

    // TRIP-210 D1 — AuthorizeResult 의 성공 멤버가 둘로 갈렸다(success-code / success-token).
    // fake 경로는 code 갈래를 흉내내므로 'success-code' 다.
    expect(result.type).toBe('success-code');
    if (result.type !== 'success-code') {
      throw new Error('unreachable');
    }
    expect(result.authorizationCode).toEqual(expect.any(String));
    expect(result.authorizationCode.length).toBeGreaterThan(0);
    expect(result.codeVerifier).toEqual(expect.any(String));
    expect(result.codeVerifier.length).toBeGreaterThan(0);
    expect(result.redirectUri).toContain('google');
  });

  it('성공 결과는 codeVerifier 만 담고 어떤 클라이언트 시크릿도 담지 않는다 (AC-W-08 · SEC-AUTH)', async () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME = 'success';

    const result = await makeAuthorize('kakao')();

    const keys = Object.keys(result).map((k) => k.toLowerCase());
    expect(keys).toContain('codeverifier');
    expect(keys).not.toContain('clientsecret');
    expect(keys).not.toContain('client_secret');
    expect(keys).not.toContain('secret');
  });

  it('EXPO_PUBLIC_AUTH_FAKE_OUTCOME=cancel 이면 { type: "cancel" } 을 낸다', async () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME = 'cancel';

    const result = await makeAuthorize('google')();

    expect(result.type).toBe('cancel');
  });

  it('EXPO_PUBLIC_AUTH_FAKE_OUTCOME=dismiss 이면 { type: "dismiss" } 을 낸다', async () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME = 'dismiss';

    const result = await makeAuthorize('naver')();

    expect(result.type).toBe('dismiss');
  });

  it('알 수 없는 값이 들어오면 조용히 깨지지 않고 success-code 로 되돌아간다', async () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME = 'nonsense-value';

    const result = await makeAuthorize('apple')();

    expect(result.type).toBe('success-code');
  });
});

describe('makeAuthorize — fake 토글 OFF (실 빌드 경로, 겹1 미배선)', () => {
  it('토글이 꺼지면 결과 지정이 있어도 가짜 성공을 내지 않는다 (실 OAuth 는 겹2 — 미배선이므로 거부)', async () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '';
    process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME = 'success';

    await expect(makeAuthorize('google')()).rejects.toBeDefined();
  });
});
