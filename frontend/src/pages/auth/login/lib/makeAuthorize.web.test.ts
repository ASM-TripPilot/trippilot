import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { postSocialLogin } from '@/shared/api';
import { saveTokens } from '@/shared/storage';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';

import {
  authRequestConstructorSpy,
  promptAsyncSpy,
  resetExpoAuthSessionMock,
  setCodeVerifier,
  setPromptResult,
} from '@/test-support/expoAuthSessionMock';
import { sandboxEnv } from '@/test-support/envSandbox';
import {
  kakaoLoginSpy,
  resetNativeSocialSdkMock,
} from '@/test-support/nativeSocialSdkMock';

import { tokenPair } from '../model/__fixtures__/socialLogin';
import { useSocialLogin } from '../model/useSocialLogin';
import { makeAuthorize } from './makeAuthorize';

/**
 * TRIP-1649 · AC-W3-1~7 — 웹(react-native-web)에서 카카오·구글 버튼이 "팝업 OAuth(code 흐름)" 로 가는가.
 *
 * 무엇을 보장하나:
 *  - 웹에서는 .env 에 카카오 네이티브 앱 키가 있어도 카카오가 SDK 가 아니라 브라우저 OAuth(`flow:'code'`)로 간다.
 *    같은 env 로 iOS 는 여전히 SDK(`flow:'token'`)다 — 한 쌍으로 두어 "웹 분기가 iOS 로 새는 것"을 잡는다.
 *  - 구글 웹은 웹 전용 클라이언트 ID(`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`)만 쓴다. iOS 용 ID 를 웹 폴백으로 쓰지 않고,
 *    웹 ID 가 없으면 인가 전에 명시적으로 실패한다(INV-4).
 *  - 웹 redirectUri 는 `<접속 origin>/oauth/<provider>` 로 계산하고 env 의 `*_REDIRECT_URI`(iOS 역방향 스킴)는 무시한다.
 *    인가 때 쓴 값과 서버 교환 때 보낼 값(`success-code.redirectUri`)이 같은 문자열이다.
 *  - 팝업 결과 → success-code(3필드만, 시크릿 없음) / dismiss / cancel 로 정규화, 팝업 차단 등 reject 는 삼키지 않는다.
 *
 * 커버하지 않는 것: 실제 팝업이 열리고 닫히는 것·공급자 페이지·COOP·팝업 차단(브라우저 몫 — [검증] AC-W3-14·6-b),
 * 웹 번들에 시크릿이 없는지(AC-W3-13), 네이버 웹 갈래(W4).
 *
 * (개념) `jest.replaceProperty(Platform, 'OS', 'web')` = 이 테스트 동안만 `Platform.OS` 를 'web' 으로 바꾼다.
 *   구현은 반드시 `Platform.OS` 로 읽어야 한다 — `Platform.select` 는 바뀐 OS 를 안 본다(02a §5 실측).
 * (개념) 웹에서 origin = `window.location.origin`. 테스트 환경엔 `location` 이 없어서 `globalThis.location` 에 가짜를 끼운다.
 * 3동작: 준비(Platform·origin·env·목 결과) → 실행(`makeAuthorize(p)()`) → 단언(AuthRequest 인자·반환값·SDK 미호출).
 */

jest.mock(
  '@react-native-seoul/kakao-login',
  () => require('@/test-support/nativeSocialSdkMock').kakaoLoginModule,
  { virtual: true }
);
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

// 훅 경유 케이스용 — 서버로 나가는 교환 호출을 가로챈다. tokenManager 는 훅이 배럴로 물어서 실물을 펼친다(useSocialLogin.test.tsx 와 같은 장치).
jest.mock('@/shared/api', () => ({
  ...jest.requireActual('@/shared/api/tokenManager'),
  postSocialLogin: jest.fn(),
}));
jest.mock('@/shared/storage', () => ({ saveTokens: jest.fn() }));

const mockPostSocialLogin = postSocialLogin as jest.MockedFunction<
  typeof postSocialLogin
>;

sandboxEnv(
  [
    'EXPO_PUBLIC_AUTH_FAKE',
    'EXPO_PUBLIC_AUTH_FAKE_OUTCOME',
    'EXPO_PUBLIC_GOOGLE_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_REDIRECT_URI',
    'EXPO_PUBLIC_KAKAO_CLIENT_ID',
    'EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY',
    'EXPO_PUBLIC_KAKAO_REDIRECT_URI',
  ],
  { clearBefore: true }
);

// 모듈 싱글턴(Platform·globalThis.location)·스파이는 파일 최상위 afterEach 에서 되돌린다 — describe 안에만 걸면 앞 테스트의 web 이 샌다.
let restorePlatform: (() => void) | null = null;
afterEach(() => {
  restorePlatform?.();
  restorePlatform = null;
  delete (globalThis as { location?: unknown }).location;
  resetExpoAuthSessionMock();
  resetNativeSocialSdkMock();
  mockPostSocialLogin.mockReset();
});

/** 이 테스트를 웹으로 바꾸고 접속 origin 을 심는다. */
function asWeb(origin = 'https://app.example'): void {
  const replaced = jest.replaceProperty(Platform, 'OS', 'web');
  restorePlatform = () => replaced.restore();
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin },
  });
}

/** 웹 빌드가 실제로 받는 env — iOS 와 같은 .env 라 카카오 네이티브 앱 키·iOS 구글 ID·역방향 스킴 redirect 가 함께 들어 있다. */
function useWebBuildEnv(): void {
  process.env.EXPO_PUBLIC_AUTH_FAKE = '';
  process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY = 'native-key';
  process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID = 'kakao-rest-key';
  process.env.EXPO_PUBLIC_KAKAO_REDIRECT_URI = 'trippilot://oauth/kakao';
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'google-ios-client';
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'google-web-client';
  process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI = 'trippilot://oauth/google';
}

/**
 * 다음 팝업이 "성공 + code" 로 돌아오게 한다. 웹 경로는 돌아온 state 를 앱이 직접 대조하므로(AC-W3-SEC-1)
 * 성공 응답에도 state 가 필요하다 — `state` 를 안 주면 **요청이 만든 state 를 그대로 되돌려 주고**(공급자의 정상 동작),
 * 문자열을 주면 그 값으로 바꾸고(위조), `null` 이면 state 를 아예 빼 보낸다.
 * AuthRequest 생성자가 promptAsync 보다 먼저 불리므로 요청 state 는 생성자 스파이에서 읽을 수 있다.
 */
function popupSuccess({
  code = 'auth-code-c',
  state,
}: { code?: string; state?: string | null } = {}): void {
  promptAsyncSpy.mockImplementationOnce(async () => {
    const calls = authRequestConstructorSpy.mock.calls;
    const requested = calls[calls.length - 1]?.[0]?.state as string | undefined;
    const returned = state === undefined ? requested : state;
    const params: Record<string, string> = { code };
    if (typeof returned === 'string') params.state = returned;
    return { type: 'success', params };
  });
}

describe('갈래 선택 — 웹은 카카오도 브라우저 OAuth (AC-W3-1·2·3)', () => {
  it('웹: 카카오 네이티브 앱 키가 있어도 code 흐름으로 가고, 카카오 REST 키로 카카오 인가 주소에 팝업을 연다', async () => {
    useWebBuildEnv();
    asWeb();

    popupSuccess();
    const authorize = makeAuthorize('kakao');
    // "아직 없다" 앵커 — authorize 를 만들기만 해서는 팝업이 열리지 않는다.
    expect(promptAsyncSpy).not.toHaveBeenCalled();
    await authorize();

    expect(authorize.flow).toBe('code');
    expect(kakaoLoginSpy).not.toHaveBeenCalled();
    expect(authRequestConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'kakao-rest-key', usePKCE: true })
    );
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationEndpoint: 'https://kauth.kakao.com/oauth/authorize',
      })
    );
  });

  it('iOS(대조): 같은 env 로 카카오는 여전히 SDK 갈래(token)이고 팝업 OAuth 는 열리지 않는다', async () => {
    useWebBuildEnv();
    kakaoLoginSpy.mockResolvedValueOnce({ accessToken: 'kakao-token' });

    const authorize = makeAuthorize('kakao');
    const result = await authorize();

    expect(authorize.flow).toBe('token');
    expect(result).toEqual({
      type: 'success-token',
      accessToken: 'kakao-token',
    });
    expect(promptAsyncSpy).not.toHaveBeenCalled();
  });

  it('웹: 구글은 웹 클라이언트 ID 로 인가하고, 같이 들어 있는 iOS 용 ID 는 쓰지 않는다', async () => {
    useWebBuildEnv();
    asWeb();

    popupSuccess();
    const authorize = makeAuthorize('google');
    await authorize();

    expect(authorize.flow).toBe('code');
    expect(authRequestConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'google-web-client' })
    );
  });

  it('웹: 웹 클라이언트 ID 가 비어 있으면 iOS 용 ID 로 몰래 시도하지 않고, 클라이언트 미설정을 지목하며 인가 전에 실패한다 (INV-4)', async () => {
    useWebBuildEnv();
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    asWeb();

    await expect(makeAuthorize('google')()).rejects.toThrow(/client|미설정/i);

    expect(authRequestConstructorSpy).not.toHaveBeenCalled();
    expect(promptAsyncSpy).not.toHaveBeenCalled();
  });

  it('iOS(대조): 구글은 iOS 용 ID 를 쓴다 — 웹 클라이언트 ID 가 같이 있어도 바뀌지 않는다', async () => {
    useWebBuildEnv();

    await makeAuthorize('google')();

    expect(authRequestConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'google-ios-client' })
    );
  });

  it('웹이어도 AUTH_FAKE 가 켜져 있으면 fake 가 우선이라 팝업을 열지 않는다 (현행 규칙 유지)', async () => {
    useWebBuildEnv();
    process.env.EXPO_PUBLIC_AUTH_FAKE = '1';
    asWeb();

    const authorize = makeAuthorize('kakao');
    const result = await authorize();

    expect(authorize.flow).toBe('code');
    expect(result.type).toBe('success-code');
    expect(promptAsyncSpy).not.toHaveBeenCalled();
  });
});

describe('redirectUri — 웹은 접속 origin 으로 계산하고 env 는 무시 (AC-W3-4·5)', () => {
  it.each([
    ['kakao', 'https://app.example'],
    ['google', 'http://localhost:8081'],
  ] as const)(
    '웹: %s (접속 origin %s) 는 <origin>/oauth/<provider> 로 인가하고, 서버 교환용 반환값도 같은 문자열이다',
    async (provider, origin) => {
      useWebBuildEnv();
      asWeb(origin);
      setCodeVerifier('verifier-v');
      popupSuccess({ code: 'auth-code-c' });
      const expected = `${origin}/oauth/${provider}`;

      const result = await makeAuthorize(provider)();

      expect(authRequestConstructorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ redirectUri: expected })
      );
      expect(result).toEqual(
        expect.objectContaining({ type: 'success-code', redirectUri: expected })
      );
    }
  );

  it('웹: env 에 역방향 스킴 redirect 가 있어도 쓰지 않는다 (iOS 용 값이 웹 번들에 인라인되는 것을 코드로 막는다)', async () => {
    useWebBuildEnv();
    asWeb('https://app.example');
    popupSuccess();

    await makeAuthorize('kakao')();

    expect(authRequestConstructorSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: 'trippilot://oauth/kakao' })
    );
    expect(authRequestConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: 'https://app.example/oauth/kakao',
      })
    );
  });
});

describe('결과 정규화 — 팝업이 돌려준 것을 서버 계약으로 (AC-W3-6·7)', () => {
  it('성공: authorizationCode·codeVerifier·redirectUri 세 필드만 담고 시크릿 류 키는 없다', async () => {
    useWebBuildEnv();
    asWeb();
    setCodeVerifier('verifier-v');
    popupSuccess({ code: 'auth-code-c' });

    const result = await makeAuthorize('kakao')();

    expect(result).toEqual({
      type: 'success-code',
      authorizationCode: 'auth-code-c',
      codeVerifier: 'verifier-v',
      redirectUri: 'https://app.example/oauth/kakao',
    });
    expect(Object.keys(result).join(' ')).not.toMatch(/secret/i);
  });

  it('성공(구글): 웹 클라이언트로 받은 code 도 같은 3필드 계약이다', async () => {
    useWebBuildEnv();
    asWeb();
    setCodeVerifier('verifier-g');
    popupSuccess({ code: 'google-code' });

    const result = await makeAuthorize('google')();

    expect(result).toEqual({
      type: 'success-code',
      authorizationCode: 'google-code',
      codeVerifier: 'verifier-g',
      redirectUri: 'https://app.example/oauth/google',
    });
  });

  it.each([['dismiss'], ['cancel']] as const)(
    '%s 는 같은 이름의 결과로 정규화한다 (팝업을 X 로 닫으면 dismiss → 훅이 취소 안내)',
    async (type) => {
      useWebBuildEnv();
      asWeb();
      setPromptResult({ type });

      await expect(makeAuthorize('kakao')()).resolves.toEqual({ type });
    }
  );

  it('팝업 차단 등으로 promptAsync 가 거절되면 삼키지 않고 그대로 거절한다 (훅이 AUTHORIZE_FAILED 로 드러낸다 · INV-4)', async () => {
    useWebBuildEnv();
    asWeb();
    promptAsyncSpy.mockRejectedValueOnce(
      Object.assign(new Error('popup blocked'), {
        code: 'ERR_WEB_BROWSER_BLOCKED',
      })
    );

    await expect(makeAuthorize('kakao')()).rejects.toMatchObject({
      code: 'ERR_WEB_BROWSER_BLOCKED',
    });
  });
});

describe('state 대조 — 앱이 직접 만들고 직접 확인한다 (AC-W3-SEC-1 · CSRF 방어)', () => {
  // (개념) state = 인가 요청 때 앱이 만들어 보낸 일회용 난수. 공급자가 돌려줄 때 같은 값이 와야 "내가 시작한 로그인"임이 증명된다.
  //   남이 만든 인가 주소로 내 브라우저를 로그인시키는 공격(CSRF)을 막는 장치다. 라이브러리가 몰래 만들어 주는 값에 기대지 않고
  //   앱이 명시로 만들어 싣고(realAuthorize 의 naver requiresState 와 같은 원칙) 돌아온 값을 직접 비교한다.
  // iOS(google·kakao requiresState:false, 카카오 SDK)의 state 동작은 이 AC 의 범위 밖이라 단언하지 않는다 — 기존 테스트가 지킨다.

  /** 마지막 AuthRequest 가 받은 state. */
  function requestedState(): unknown {
    const calls = authRequestConstructorSpy.mock.calls;
    return calls[calls.length - 1]?.[0]?.state;
  }

  it.each([['kakao'], ['google']] as const)(
    '웹: %s 요청은 비어 있지 않은 state 를 앱이 만들어 싣고, 호출마다 값이 다르다',
    async (provider) => {
      useWebBuildEnv();
      asWeb();

      popupSuccess();
      await makeAuthorize(provider)();
      const first = requestedState();
      popupSuccess();
      await makeAuthorize(provider)();
      const second = requestedState();

      expect(typeof first).toBe('string');
      expect((first as string).length).toBeGreaterThan(0);
      expect(second).not.toBe(first);
    }
  );

  it.each([['kakao'], ['google']] as const)(
    '웹: %s 에서 돌아온 state 가 요청 state 와 같으면 정상 success-code 다',
    async (provider) => {
      useWebBuildEnv();
      asWeb();
      popupSuccess({ code: 'ok-code' });

      const result = await makeAuthorize(provider)();

      expect(result).toEqual(
        expect.objectContaining({
          type: 'success-code',
          authorizationCode: 'ok-code',
        })
      );
    }
  );

  it.each([['kakao'], ['google']] as const)(
    '웹: %s 에서 돌아온 state 가 요청과 다르면 success-code 를 내지 않고 거절한다',
    async (provider) => {
      useWebBuildEnv();
      asWeb();
      popupSuccess({ state: 'attacker-chosen-state' });

      await expect(makeAuthorize(provider)()).rejects.toThrow();
    }
  );

  it.each([['kakao'], ['google']] as const)(
    '웹: %s 에서 돌아온 params 에 state 가 없어도 거절한다 (없는 값을 통과시키지 않는다)',
    async (provider) => {
      useWebBuildEnv();
      asWeb();
      popupSuccess({ state: null });

      await expect(makeAuthorize(provider)()).rejects.toThrow();
    }
  );

  describe('훅을 거쳐도 — 불일치면 서버 교환(POST /auth/social/{provider})이 한 번도 안 나간다', () => {
    /** 훅을 렌더해 "버튼 → 연령 시트 확인" 까지 진행하고 인가(팝업)가 끝나길 기다린다. */
    async function runSignIn(): Promise<
      ReturnType<typeof renderHook<ReturnType<typeof useSocialLogin>, unknown>>
    > {
      const rendered = renderHook(() => useSocialLogin(), {
        wrapper: createWrapper(newTestQueryClient()),
      });
      act(() => {
        rendered.result.current.signIn('kakao', makeAuthorize('kakao'));
      });
      await waitFor(() =>
        expect(rendered.result.current.phase).toBe('needs-age')
      );
      act(() => {
        rendered.result.current.confirmAge();
      });
      return rendered;
    }

    beforeEach(() => {
      (saveTokens as jest.Mock).mockReset().mockResolvedValue(undefined);
    });

    it('state 불일치: 훅은 AUTHORIZE_FAILED 로 드러내고 서버 호출은 0회다', async () => {
      useWebBuildEnv();
      asWeb();
      popupSuccess({ state: 'attacker-chosen-state' });

      const { result } = await runSignIn();

      await waitFor(() => expect(result.current.phase).toBe('error'));
      expect(result.current.errorCode).toBe('AUTHORIZE_FAILED');
      expect(mockPostSocialLogin).not.toHaveBeenCalled();
    });

    it('대조(state 일치): 같은 흐름에서 서버 교환이 정확히 한 번 나간다 — 위 0회가 "흐름이 안 돌아서"가 아님을 보인다', async () => {
      useWebBuildEnv();
      asWeb();
      mockPostSocialLogin.mockResolvedValue(tokenPair(true));
      popupSuccess({ code: 'ok-code' });

      const { result } = await runSignIn();

      await waitFor(() => expect(result.current.phase).toBe('success'));
      expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
    });
  });
});
