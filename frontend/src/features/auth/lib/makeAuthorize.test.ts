import { resetScenario, setScenario } from '@/mocks/scenarios';
import { makeAuthorize } from './makeAuthorize';

/**
 * AC-W-08 · AC-W-12 · makeAuthorize — dev fake provider 팩토리(OAuth DI 씨앗).
 *
 * 무엇을 보장하나: 컨테이너가 `signIn(provider, makeAuthorize(provider))` 로 주입하는 `authorize` 가
 *  (1) env 토글 `EXPO_PUBLIC_AUTH_FAKE` 가 켜졌을 때만 가짜 인가 결과를 내고,
 *  (2) 성공 결과에는 codeVerifier 만 담기고 어떤 시크릿도 없으며(PKCE·시크릿 비노출),
 *  (3) 활성 시나리오에 따라 success/cancel/dismiss 를 낸다,
 *  (4) 토글이 꺼진 실 빌드 경로에서는 가짜 성공을 내지 않는다(dev 전용).
 *
 * 3동작: 준비(env·시나리오 set) → 실행(makeAuthorize(provider)() 호출) → 단언(AuthorizeResult).
 */

const ORIGINAL_FAKE = process.env.EXPO_PUBLIC_AUTH_FAKE;

afterEach(() => {
  resetScenario();
  process.env.EXPO_PUBLIC_AUTH_FAKE = ORIGINAL_FAKE;
});

describe('makeAuthorize — fake 토글 ON (dev)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '1';
  });

  it('성공 시나리오는 authorizationCode·codeVerifier·provider별 redirectUri 를 담은 success 를 낸다', async () => {
    setScenario('login-success-existing');

    const result = await makeAuthorize('google')();

    expect(result.type).toBe('success');
    if (result.type !== 'success') {
      throw new Error('unreachable');
    }
    expect(result.authorizationCode).toEqual(expect.any(String));
    expect(result.authorizationCode.length).toBeGreaterThan(0);
    expect(result.codeVerifier).toEqual(expect.any(String));
    expect(result.codeVerifier.length).toBeGreaterThan(0);
    expect(result.redirectUri).toContain('google');
  });

  it('성공 결과는 codeVerifier 만 담고 어떤 클라이언트 시크릿도 담지 않는다 (AC-W-08 · SEC-AUTH)', async () => {
    setScenario('login-success-new');

    const result = await makeAuthorize('kakao')();

    const keys = Object.keys(result).map((k) => k.toLowerCase());
    expect(keys).toContain('codeverifier');
    expect(keys).not.toContain('clientsecret');
    expect(keys).not.toContain('client_secret');
    expect(keys).not.toContain('secret');
  });

  it('취소 시나리오는 { type: "cancel" } 을 낸다', async () => {
    setScenario('login-cancel');
    const result = await makeAuthorize('google')();
    expect(result.type).toBe('cancel');
  });

  it('dismiss 시나리오는 { type: "dismiss" } 을 낸다', async () => {
    setScenario('login-dismiss');
    const result = await makeAuthorize('naver')();
    expect(result.type).toBe('dismiss');
  });
});

describe('makeAuthorize — fake 토글 OFF (실 빌드 경로, 겹1 미배선)', () => {
  it('토글이 꺼지면 가짜 성공을 내지 않는다 (실 OAuth 는 겹2 — 미배선이므로 거부)', async () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '';
    setScenario('login-success-existing');

    await expect(makeAuthorize('google')()).rejects.toBeDefined();
  });
});
