import {
  authRequestConstructorSpy,
  promptAsyncSpy,
  resetExpoAuthSessionMock,
  setCodeVerifier,
  setPromptResult,
} from '@/test-support/expoAuthSessionMock';

import { makeAuthorize } from './makeAuthorize';

/**
 * AC-OA-1(runtime) · AC-OA-2 · AC-OA-3 · AC-OA-4 · AC-OA-5 — makeAuthorize 실 OAuth 경로(목).
 *
 * 무엇을 보장하나: 토글이 꺼진 실 경로에서 makeAuthorize 가
 *  (2) promptAsync 성공을 서버가 요구하는 PKCE 3필드 success 로 정규화하고,
 *  (3) 취소/닫힘을 cancel/dismiss 로 정규화하며,
 *  (4) clientId 가 없으면 빈 값으로 OAuth 를 시도하지 않고 명시적으로 throw 하고(INV-4),
 *  (5) 성공 결과에 codeVerifier 만 담고 시크릿은 담지 않는다(SEC-AUTH).
 * (1)은 fake 토글이 켜지면 실 promptAsync 를 건드리지 않는다는 격리를 확인한다.
 *
 * 실 expo-auth-session 은 미설치 네이티브 모듈이라 { virtual: true } 로 목킹한다 —
 * 실제로 없는 모듈이어도 팩토리로 대체하겠다는 뜻이다. 스파이는 목 파일에서 가져온다(모듈 동일성).
 * makeAuthorize 의 실 경로는 아직 미구현(토글 off 시 throw)이라 (2)~(5)는 red 다.
 */

jest.mock(
  'expo-auth-session',
  () => require('@/test-support/expoAuthSessionMock').expoAuthSessionModule,
  { virtual: true }
);
jest.mock(
  'expo-web-browser',
  () => require('@/test-support/expoAuthSessionMock').expoWebBrowserModule,
  { virtual: true }
);
jest.mock(
  'expo-crypto',
  () => require('@/test-support/expoAuthSessionMock').expoCryptoModule,
  { virtual: true }
);

const ENV_KEYS = [
  'EXPO_PUBLIC_AUTH_FAKE',
  'EXPO_PUBLIC_AUTH_FAKE_OUTCOME',
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_REDIRECT_URI',
  'EXPO_PUBLIC_GOOGLE_SCOPES',
  'EXPO_PUBLIC_KAKAO_CLIENT_ID',
  'EXPO_PUBLIC_KAKAO_REDIRECT_URI',
  'EXPO_PUBLIC_NAVER_CLIENT_ID',
  'EXPO_PUBLIC_NAVER_REDIRECT_URI',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  ORIGINAL_ENV[key] = process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
  resetExpoAuthSessionMock();
});

/** 실 경로 진입 조건(토글 off + Google clientId·redirectUri 설정)을 세팅한다. */
function useRealPathEnv(): void {
  process.env.EXPO_PUBLIC_AUTH_FAKE = '';
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI = 'trippilot://oauth/google';
}

/** 실 경로 진입 조건(토글 off + kakao clientId 설정)을 세팅한다(AC-S4). */
function useKakaoRealPathEnv(): void {
  process.env.EXPO_PUBLIC_AUTH_FAKE = '';
  process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID = 'test-kakao-id';
}

/** 실 경로 진입 조건(토글 off + naver clientId 설정)을 세팅한다(AC-S4 · PKCE 예외). */
function useNaverRealPathEnv(): void {
  process.env.EXPO_PUBLIC_AUTH_FAKE = '';
  process.env.EXPO_PUBLIC_NAVER_CLIENT_ID = 'test-naver-id';
}

describe('AC-OA-1 · fake 격리 (실 네이티브 모듈 비접근)', () => {
  it('fake 토글이 켜지면 실 promptAsync 를 부르지 않고 fake success 를 낸다', async () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '1';
    delete process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME;

    const result = await makeAuthorize('google')();

    // TRIP-210 D1 — 성공 멤버가 success-code / success-token 으로 갈렸다. 브라우저 OAuth 는 code 갈래.
    expect(result.type).toBe('success-code');
    expect(promptAsyncSpy).not.toHaveBeenCalled();
  });
});

describe('AC-OA-2 · 실 경로 success (PKCE 3필드)', () => {
  it('토글 off + clientId 설정이면 promptAsync 성공을 authorizationCode·codeVerifier·redirectUri success 로 정규화한다', async () => {
    useRealPathEnv();
    setPromptResult({ type: 'success', params: { code: 'auth-code-c' } });
    setCodeVerifier('verifier-v');

    const result = await makeAuthorize('google')();

    expect(result.type).toBe('success-code');
    if (result.type !== 'success-code') {
      throw new Error('unreachable');
    }
    expect(result.authorizationCode).toBe('auth-code-c');
    expect(result.codeVerifier).toBe('verifier-v');
    expect(result.redirectUri).toBe('trippilot://oauth/google');
    expect(authRequestConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'test-google-client-id',
        usePKCE: true,
      })
    );
  });
});

describe('AC-OA-3 · 취소/닫힘 (US-ONB-01 취소 시나리오)', () => {
  it('promptAsync 결과가 cancel 이면 { type: "cancel" } 로 정규화한다', async () => {
    useRealPathEnv();
    setPromptResult({ type: 'cancel' });

    const result = await makeAuthorize('google')();

    expect(result).toEqual({ type: 'cancel' });
  });

  it('promptAsync 결과가 dismiss 이면 { type: "dismiss" } 로 정규화한다', async () => {
    useRealPathEnv();
    setPromptResult({ type: 'dismiss' });

    const result = await makeAuthorize('google')();

    expect(result).toEqual({ type: 'dismiss' });
  });
});

describe('AC-OA-4 · config 부재 방어 (INV-4 · 침묵 실패 금지)', () => {
  it('토글 off + clientId 없음이면 빈 값으로 OAuth 를 시도하지 않고 client 설정을 지목하며 throw 한다', async () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '';
    delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
    process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI = 'trippilot://oauth/google';

    await expect(makeAuthorize('google')()).rejects.toThrow(/client|미설정/i);
    expect(promptAsyncSpy).not.toHaveBeenCalled();
  });
});

describe('AC-OA-5 · 시크릿 비노출 (SEC-AUTH)', () => {
  it('실 경로 success 결과는 codeVerifier 만 담고 clientSecret/secret 을 담지 않는다', async () => {
    useRealPathEnv();
    setPromptResult({ type: 'success', params: { code: 'auth-code-c' } });
    setCodeVerifier('verifier-v');

    const result = await makeAuthorize('google')();

    expect(result.type).toBe('success-code');
    const keys = Object.keys(result).map((k) => k.toLowerCase());
    expect(keys).toContain('codeverifier');
    expect(keys).not.toContain('clientsecret');
    expect(keys).not.toContain('client_secret');
    expect(keys).not.toContain('secret');
  });
});

describe('AC-S4 · kakao 실 경로 (결함 C · 케이스 21)', () => {
  it('kakao 실 경로가 kakao 설정으로 인가 요청을 만든다', async () => {
    // 준비 — 토글 off + kakao clientId 주입 + kakao 인가 성공 결과 주입.
    useKakaoRealPathEnv();
    setPromptResult({ type: 'success', params: { code: 'kakao-code' } });

    // 실행
    const result = await makeAuthorize('kakao')();

    // 단언 — AuthRequest 가 kakao clientId·usePKCE:true 로 생성되고, promptAsync 가
    // kakao discovery(authorizationEndpoint)를 실제로 받았는지까지 확인한다.
    expect(authRequestConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'test-kakao-id', usePKCE: true })
    );
    expect(promptAsyncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationEndpoint: expect.stringContaining('kauth.kakao.com'),
      })
    );
    expect(result).toMatchObject({
      type: 'success-code',
      authorizationCode: 'kakao-code',
    });
  });
});

describe('AC-S4 · naver PKCE 예외 (결함 C · 대조쌍 · 케이스 22)', () => {
  it('naver 는 usePKCE:false + state 를 담고, google 은 usePKCE:true 를 유지한다', async () => {
    // 준비 — naver·google 두 provider 의 실 경로 env 를 모두 채운다(오염 여부 대조).
    useNaverRealPathEnv();
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI = 'trippilot://oauth/google';
    setPromptResult({ type: 'success', params: { code: 'naver-code' } });

    // 실행 — resetExpoAuthSessionMock() 없이 이어서 호출해 같은 스파이의 calls[0]/[1] 로 구분한다.
    await makeAuthorize('naver')();
    await makeAuthorize('google')();

    const naverCfg = authRequestConstructorSpy.mock.calls[0][0] as {
      usePKCE: boolean;
      state?: string;
    };
    const googleCfg = authRequestConstructorSpy.mock.calls[1][0] as {
      usePKCE: boolean;
    };

    // 단언 — naver 는 PKCE 꺼짐 + state 비어있지 않음, google 은 PKCE 유지.
    expect(naverCfg.usePKCE).toBe(false);
    expect(typeof naverCfg.state).toBe('string');
    expect((naverCfg.state as string).length).toBeGreaterThan(0);
    expect(googleCfg.usePKCE).toBe(true);
    // 대조가 실제로 갈렸다 — naver 예외 처리가 google 을 오염시키지 않았다.
    expect(googleCfg.usePKCE).not.toBe(naverCfg.usePKCE);
  });
});

describe('AC-S4 · naver codeVerifier 비지 않음 (결함 C · 백엔드 @NotBlank · 케이스 23)', () => {
  it('naver 결과의 codeVerifier 는 빈 문자열이 아니다', async () => {
    // 준비 — naver 실 경로. 목이 usePKCE:false 를 받으면 codeVerifier 를 undefined 로
    // 주므로(§3-6 인프라 수정), 여기서 실 위험(빈 문자열 → 백엔드 400)이 재현된다.
    useNaverRealPathEnv();
    setPromptResult({ type: 'success', params: { code: 'naver-code' } });

    // 실행
    const result = await makeAuthorize('naver')();

    // 단언 — 빈 문자열도, 공백만 채운 우회도 금지한다.
    expect(result.type).toBe('success-code');
    if (result.type !== 'success-code') {
      throw new Error('unreachable');
    }
    expect(typeof result.codeVerifier).toBe('string');
    expect(result.codeVerifier).not.toBe('');
    expect(result.codeVerifier.trim().length).toBeGreaterThan(0);
  });
});

describe('AC-S4 · 3종 실 경로 시크릿 비노출 (SEC-06 · 케이스 24)', () => {
  it.each(['google', 'kakao', 'naver'] as const)(
    '%s 실 경로 결과에 시크릿이 없다',
    async (provider) => {
      // 준비 — provider 별 실 경로 env.
      if (provider === 'google') {
        useRealPathEnv();
      } else if (provider === 'kakao') {
        useKakaoRealPathEnv();
      } else {
        useNaverRealPathEnv();
      }
      setPromptResult({
        type: 'success',
        params: { code: `${provider}-code` },
      });

      // 실행
      const result = await makeAuthorize(provider)();

      // 단언 — 시크릿 키 부재 + codeVerifier 존재(공허한 통과 방지, SEC-06).
      const keys = Object.keys(result).map((k) => k.toLowerCase());
      expect(keys).not.toContain('clientsecret');
      expect(keys).not.toContain('client_secret');
      expect(keys).not.toContain('secret');
      expect(keys).toContain('codeverifier');
    }
  );
});
