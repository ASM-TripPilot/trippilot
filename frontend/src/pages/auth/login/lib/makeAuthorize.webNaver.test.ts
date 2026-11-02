import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { postSocialLogin, postSocialTokenLogin } from '@/shared/api';
import { saveTokens } from '@/shared/storage';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';

import {
  authRequestConstructorSpy,
  promptAsyncSpy,
  resetExpoAuthSessionMock,
  type MockPromptResult,
} from '@/test-support/expoAuthSessionMock';
import { sandboxEnv } from '@/test-support/envSandbox';
import {
  naverInitializeSpy,
  naverLoginSpy,
  resetNativeSocialSdkMock,
} from '@/test-support/nativeSocialSdkMock';

import {
  ageConfirmationRequired,
  tokenPair,
} from '../model/__fixtures__/socialLogin';
import { useSocialLogin } from '../model/useSocialLogin';
import { isNaverLoginAvailable } from './isNaverLoginAvailable';
import { makeAuthorize } from './makeAuthorize';

/**
 * TRIP-1650 · AC-W4-1~10 + 보안 AC(SEC-2·2b) — 웹(react-native-web)에서 "네이버로 계속하기" 가 implicit 팝업 OAuth 로 가는가.
 *
 * (개념) implicit = 인가 "코드"를 서버에서 교환하지 않고, 브라우저가 팝업이 돌아오는 주소의 `#access_token=…`(fragment)로 토큰을 바로 받는 방식.
 *   네이버는 PKCE(코드 가로채기 방어)가 없어서 서버가 code 경로를 닫았고(501, TRIP-1317) 토큰 경로(`/auth/social/naver/token`)만 쓴다.
 * (개념) state = 요청 때 앱이 만든 일회용 난수. 응답이 같은 값을 돌려줘야 "내가 시작한 로그인"이다. implicit 은 PKCE 가 없어 이게 유일한 CSRF 방어다.
 *
 * 무엇을 보장하나:
 *  - 웹에서는 URL 스킴 없이 `NAVER_CLIENT_ID` 만 있어도 네이버 팝업(response_type=token·PKCE 없음·앱이 만든 state)으로 가고,
 *    네이티브 SDK 는 건드리지 않는다. client secret 은 웹 경로 어디에도 실리지 않는다. 같은 env 로 iOS 는 여전히 SDK 다.
 *  - 팝업 결과 → `{type:'success-token', accessToken}` **두 키만**. state 불일치·없음·`error` 결과의 토큰·access_token 없음은 전부 거절하고,
 *    그 거절 메시지에 토큰·위조 state 값이 실리지 않는다. 동의 거부(`access_denied`)는 취소로, 다른 에러는 거절로.
 *  - 훅까지 이어 붙여도: 정상이면 연령 시트 없이 `POST /auth/social/naver/token` 만 한 번(code 경로 `/auth/social/naver` 0회),
 *    신규 가입이면 같은 토큰으로 재전송(팝업 재오픈 없음). 위조·부재는 서버 호출 0회 + 실패 표시.
 *
 * 커버하지 않는 것: 실제 팝업·COOP·네이버 콘솔 Callback 등록·네이버가 취소 때 돌려주는 error 이름(실측 불가)·웹 번들 시크릿 grep·인가 URL 실측([검증]).
 *
 * (개념) `jest.replaceProperty(Platform,'OS','web')` = 이 테스트 동안만 "웹인 척". 구현은 `Platform.OS` 로 읽어야 한다(`Platform.select` 는 바뀐 OS 를 안 본다 — W3 02a ★1).
 * 3동작: 준비(Platform·origin·env·팝업 결과) → 실행(`makeAuthorize('naver')()` 또는 훅 `signIn`) → 단언(AuthRequest 인자·반환값·서버 호출).
 */

jest.mock(
  '@react-native-seoul/naver-login',
  () => require('@/test-support/nativeSocialSdkMock').naverLoginModule,
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

// 훅 경유 케이스용 — 서버로 나가는 교환 호출 둘을 나란히 가로챈다("무엇을 불렀나"가 아니라 "무엇을 부르고 무엇을 안 불렀나"의 쌍).
jest.mock('@/shared/api', () => ({
  ...jest.requireActual('@/shared/api/tokenManager'),
  postSocialLogin: jest.fn(),
  postSocialTokenLogin: jest.fn(),
}));
jest.mock('@/shared/storage', () => ({ saveTokens: jest.fn() }));

const mockPostSocialLogin = postSocialLogin as jest.MockedFunction<
  typeof postSocialLogin
>;
const mockPostSocialTokenLogin = postSocialTokenLogin as jest.MockedFunction<
  typeof postSocialTokenLogin
>;

sandboxEnv(
  [
    'EXPO_PUBLIC_AUTH_FAKE',
    'EXPO_PUBLIC_AUTH_FAKE_OUTCOME',
    'EXPO_PUBLIC_NAVER_CLIENT_ID',
    'EXPO_PUBLIC_NAVER_CLIENT_SECRET',
    'EXPO_PUBLIC_NAVER_URL_SCHEME',
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
  naverInitializeSpy.mockClear();
  mockPostSocialLogin.mockReset();
  mockPostSocialTokenLogin.mockReset();
});

// 테스트용 가짜 값만 — 실제 키·토큰 아님.
const TOKEN = 'SECRET-TOKEN-7Q2X';
const FORGED_STATE = 'attacker-chosen-state';
const FAKE_SECRET = 'fake-naver-secret-marker';

/** 이 테스트를 웹으로 바꾸고 접속 origin 을 심는다. */
function asWeb(origin = 'https://app.example'): void {
  const replaced = jest.replaceProperty(Platform, 'OS', 'web');
  restorePlatform = () => replaced.restore();
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin },
  });
}

/** 웹 빌드가 받는 네이버 env — 웹은 CLIENT_ID 만 필요하다(스킴·시크릿은 iOS SDK 용). */
function useWebNaverEnv(): void {
  process.env.EXPO_PUBLIC_AUTH_FAKE = '';
  process.env.EXPO_PUBLIC_NAVER_CLIENT_ID = 'naver-web-cid';
}

/**
 * 다음 팝업 결과를 정한다. `build` 는 **요청이 만든 state** 를 받는다 — AuthRequest 생성자가 promptAsync 보다 먼저 불리므로
 * 생성자 스파이에서 읽을 수 있다. 정상 응답은 이 state 를 그대로 되돌려 주고, 위조는 다른 값·없음·빈 문자열을 준다.
 */
function popupReturns(
  build: (requestedState: string) => MockPromptResult
): void {
  promptAsyncSpy.mockImplementationOnce(async () => {
    const calls = authRequestConstructorSpy.mock.calls;
    const requested = calls[calls.length - 1]?.[0]?.state as string;
    return build(requested);
  });
}

/** 정상 implicit 응답: 요청 state 를 되돌려 주고 access_token 을 싣는다. */
function popupToken(token = TOKEN): void {
  popupReturns((state) => ({
    type: 'success',
    params: { access_token: token, state, token_type: 'bearer' },
  }));
}

/** 거절되는 것과, 그 메시지에 토큰·위조 state 가 새지 않는 것을 함께 본다(SEC-2·2b). */
async function expectRejectsWithoutLeak(
  authorize: () => Promise<unknown>
): Promise<void> {
  let caught: unknown;
  try {
    await authorize();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  const message = (caught as Error).message;
  expect(message).not.toContain(TOKEN);
  expect(message).not.toContain(FORGED_STATE);
}

/** 토큰을 쓰면 안 되는 팝업 응답 6종(요청 state 를 인자로 받는다). 라이브러리 단독이 아니라 앱이 직접 거르는 것을 잠근다. */
const REJECTED_POPUPS: readonly (readonly [
  string,
  (requestedState: string) => MockPromptResult,
])[] = [
  [
    'state 가 요청과 다르면',
    () => ({
      type: 'success',
      params: { access_token: TOKEN, state: FORGED_STATE },
    }),
  ],
  [
    'state 가 아예 없으면',
    () => ({ type: 'success', params: { access_token: TOKEN } }),
  ],
  [
    'state 가 빈 문자열이면',
    () => ({ type: 'success', params: { access_token: TOKEN, state: '' } }),
  ],
  [
    '라이브러리가 state_mismatch 로 분류한 error 결과면(params 에 토큰이 들어 있어도)',
    () => ({
      type: 'error',
      params: { access_token: TOKEN, state: FORGED_STATE },
    }),
  ],
  [
    'state 가 맞아도 access_token 이 없으면',
    (state) => ({ type: 'success', params: { state } }),
  ],
  [
    'state 가 맞아도 access_token 이 빈 문자열이면',
    (state) => ({ type: 'success', params: { state, access_token: '' } }),
  ],
];

describe('갈래·인가 요청 — 웹은 스킴 없이 CLIENT_ID 만으로 implicit 팝업 (AC-W4-1·2·3)', () => {
  it('웹: CLIENT_ID 만 있으면 token 갈래로 네이버 인가 주소에 팝업을 열고 SDK 는 건드리지 않는다', async () => {
    useWebNaverEnv();
    asWeb();
    popupToken();

    const authorize = makeAuthorize('naver');
    // "아직 없다" 앵커 — authorize 를 만들기만 해서는 팝업이 열리지 않는다.
    expect(promptAsyncSpy).not.toHaveBeenCalled();
    await authorize();

    expect(authorize.flow).toBe('token');
    expect(authRequestConstructorSpy).toHaveBeenCalledTimes(1);
    expect(authRequestConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'naver-web-cid',
        redirectUri: 'https://app.example/oauth/naver',
        responseType: 'token',
        usePKCE: false,
        scopes: [],
      })
    );
    const sent = authRequestConstructorSpy.mock.calls[0][0];
    expect(typeof sent.state).toBe('string');
    expect(sent.state.length).toBeGreaterThan(0);
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationEndpoint: 'https://nid.naver.com/oauth2.0/authorize',
      })
    );
    expect(naverInitializeSpy).not.toHaveBeenCalled();
    expect(naverLoginSpy).not.toHaveBeenCalled();
  });

  it('웹: state 는 로그인 시도마다 새로 만든다(재사용하면 CSRF 방어가 무너진다)', async () => {
    useWebNaverEnv();
    asWeb();

    popupToken();
    await makeAuthorize('naver')();
    popupToken();
    await makeAuthorize('naver')();

    const [first, second] = authRequestConstructorSpy.mock.calls.map(
      ([config]) => config.state
    );
    expect(typeof first).toBe('string');
    expect(typeof second).toBe('string');
    expect(second).not.toBe(first);
  });

  it('웹: env 에 client secret·URL 스킴이 같이 들어 있어도 웹 경로 어디에도 실리지 않는다 (SEC-AUTH)', async () => {
    useWebNaverEnv();
    process.env.EXPO_PUBLIC_NAVER_CLIENT_SECRET = FAKE_SECRET;
    process.env.EXPO_PUBLIC_NAVER_URL_SCHEME = 'fake-naver-scheme';
    asWeb();
    popupToken();

    const result = await makeAuthorize('naver')();

    const everything = JSON.stringify([
      authRequestConstructorSpy.mock.calls,
      promptAsyncSpy.mock.calls,
      result,
    ]);
    expect(everything).not.toContain(FAKE_SECRET);
    expect(naverInitializeSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['스킴만 있고 CLIENT_ID 가 없으면', 'fake-naver-scheme'],
    ['스킴도 CLIENT_ID 도 없으면', ''],
  ] as const)(
    '웹: %s 인가 전에 "네이버 미설정"으로 실패하고 팝업·SDK 는 열리지 않는다 (INV-4)',
    async (_name, scheme) => {
      process.env.EXPO_PUBLIC_AUTH_FAKE = '';
      process.env.EXPO_PUBLIC_NAVER_URL_SCHEME = scheme;
      asWeb();

      await expect(makeAuthorize('naver')()).rejects.toThrow(/NAVER|미설정/);

      expect(authRequestConstructorSpy).not.toHaveBeenCalled();
      expect(promptAsyncSpy).not.toHaveBeenCalled();
      expect(naverInitializeSpy).not.toHaveBeenCalled();
      expect(naverLoginSpy).not.toHaveBeenCalled();
    }
  );

  it('iOS(대조): CLIENT_ID 만 있고 스킴이 없으면 웹처럼 팝업으로 가지 않고 인가 전에 실패한다', async () => {
    useWebNaverEnv();

    await expect(makeAuthorize('naver')()).rejects.toThrow(/NAVER|미설정/);

    expect(authRequestConstructorSpy).not.toHaveBeenCalled();
    expect(promptAsyncSpy).not.toHaveBeenCalled();
  });

  it('iOS(대조): 스킴과 CLIENT_ID 가 있으면 여전히 네이티브 SDK 갈래이고 팝업 OAuth 는 열리지 않는다', async () => {
    useWebNaverEnv();
    process.env.EXPO_PUBLIC_NAVER_URL_SCHEME = 'fake-naver-scheme';
    process.env.EXPO_PUBLIC_NAVER_CLIENT_SECRET = FAKE_SECRET;
    naverLoginSpy.mockResolvedValueOnce({
      isSuccess: true,
      successResponse: { accessToken: 'ios-sdk-token', tokenType: 'bearer' },
    });

    const authorize = makeAuthorize('naver');
    const result = await authorize();

    expect(authorize.flow).toBe('token');
    expect(result).toEqual({
      type: 'success-token',
      accessToken: 'ios-sdk-token',
    });
    expect(naverLoginSpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy).not.toHaveBeenCalled();
    expect(authRequestConstructorSpy).not.toHaveBeenCalled();
  });
});

describe('결과 정규화 — 팝업이 돌려준 것을 서버 계약으로 (AC-W4-4·6·7)', () => {
  it('성공: state 가 일치하면 accessToken 한 필드만 담은 success-token 이다 (code·verifier·redirectUri·시크릿 키 없음)', async () => {
    useWebNaverEnv();
    asWeb();
    popupToken();

    const result = await makeAuthorize('naver')();

    expect(result).toEqual({ type: 'success-token', accessToken: TOKEN });
  });

  it('동의 거부(access_denied): state 가 일치해도 없어도 취소로 매핑한다 — 실패 배너가 아니다 (US-ONB-01)', async () => {
    useWebNaverEnv();
    asWeb();

    popupReturns((state) => ({
      type: 'error',
      params: {
        error: 'access_denied',
        error_description: 'Canceled By User',
        state,
      },
    }));
    await expect(makeAuthorize('naver')()).resolves.toEqual({ type: 'cancel' });

    popupReturns(() => ({
      type: 'error',
      params: { error: 'access_denied' },
    }));
    await expect(makeAuthorize('naver')()).resolves.toEqual({ type: 'cancel' });
  });

  it('access_denied 가 아닌 에러(server_error 등)는 취소로 둔갑하지 않고 거절한다', async () => {
    useWebNaverEnv();
    asWeb();
    popupReturns((state) => ({
      type: 'error',
      params: { error: 'server_error', state, access_token: TOKEN },
    }));

    await expectRejectsWithoutLeak(makeAuthorize('naver'));
  });

  it.each([['dismiss'], ['cancel']] as const)(
    '%s 는 같은 이름의 결과로 통과한다 (팝업을 X 로 닫으면 dismiss → 훅이 취소 안내)',
    async (type) => {
      useWebNaverEnv();
      asWeb();
      popupReturns(() => ({ type }));

      await expect(makeAuthorize('naver')()).resolves.toEqual({ type });
    }
  );

  it('팝업 차단 등으로 promptAsync 가 거절되면 삼키지 않고 그대로 거절한다 (INV-4)', async () => {
    useWebNaverEnv();
    asWeb();
    promptAsyncSpy.mockRejectedValueOnce(
      Object.assign(new Error('popup blocked'), {
        code: 'ERR_WEB_BROWSER_BLOCKED',
      })
    );

    await expect(makeAuthorize('naver')()).rejects.toMatchObject({
      code: 'ERR_WEB_BROWSER_BLOCKED',
    });
  });
});

describe('state·토큰 부재는 토큰을 쓰지 않는다 (AC-W4-SEC-2 · SEC-2b)', () => {
  // 짝: 같은 환경에서 state 가 맞으면 success-token 이다 — 아래 거절이 "웹 갈래가 안 열려서"가 아님을 보인다(02a ★9).
  it('대조: 같은 환경에서 요청 state 를 되돌려 주면 정상 success-token 이다', async () => {
    useWebNaverEnv();
    asWeb();
    popupToken();

    await expect(makeAuthorize('naver')()).resolves.toEqual({
      type: 'success-token',
      accessToken: TOKEN,
    });
  });

  it.each(REJECTED_POPUPS)(
    '%s 거절하고, 메시지에 토큰·위조 state 를 싣지 않는다',
    async (_name, build) => {
      useWebNaverEnv();
      asWeb();
      popupReturns(build);

      await expectRejectsWithoutLeak(makeAuthorize('naver'));
    }
  );
});

describe('훅을 거쳐도 — 서버 교환은 /token 한 길뿐이다 (AC-W4-9 · SEC-2)', () => {
  function renderLogin() {
    return renderHook(() => useSocialLogin(), {
      wrapper: createWrapper(newTestQueryClient()),
    });
  }

  beforeEach(() => {
    (saveTokens as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('기존 사용자: 연령 시트 없이 인가 → POST /auth/social/naver/token { accessToken } 한 번, code 경로(/auth/social/naver)는 0회', async () => {
    useWebNaverEnv();
    asWeb();
    popupToken();
    mockPostSocialTokenLogin.mockResolvedValue(tokenPair(false, 'NAVER'));
    const { result } = renderLogin();
    // "아직 없다" 앵커 — signIn 전에는 서버 호출이 없다.
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();

    act(() => {
      result.current.signIn('naver', makeAuthorize('naver'));
    });

    // confirmAge 를 부르지 않았는데 success 에 닿는다 = 인가 전 연령 시트가 없다(token 갈래).
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(1);
    expect(mockPostSocialTokenLogin).toHaveBeenCalledWith('naver', {
      accessToken: TOKEN,
    });
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1);
  });

  it('신규 가입: 400(연령확인 필요) → 시트 → 확인하면 같은 토큰에 ageConfirmation 만 얹어 재전송하고 팝업은 다시 열리지 않는다', async () => {
    useWebNaverEnv();
    asWeb();
    popupToken();
    mockPostSocialTokenLogin
      .mockRejectedValueOnce(ageConfirmationRequired())
      .mockResolvedValue(tokenPair(true, 'NAVER'));
    const { result } = renderLogin();

    act(() => {
      result.current.signIn('naver', makeAuthorize('naver'));
    });
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));
    act(() => {
      result.current.confirmAge();
    });

    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(mockPostSocialTokenLogin.mock.calls).toEqual([
      ['naver', { accessToken: TOKEN }],
      [
        'naver',
        {
          accessToken: TOKEN,
          ageConfirmation: { method: 'SELF_DECLARED' },
        },
      ],
    ]);
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1);
  });

  it.each(REJECTED_POPUPS)(
    '%s: 실패 표시(AUTHORIZE_FAILED)만 하고 서버 호출·토큰 저장은 0회다',
    async (_name, build) => {
      useWebNaverEnv();
      asWeb();
      popupReturns(build);
      const { result } = renderLogin();

      act(() => {
        result.current.signIn('naver', makeAuthorize('naver'));
      });

      await waitFor(() => expect(result.current.phase).toBe('error'));
      expect(result.current.errorCode).toBe('AUTHORIZE_FAILED');
      expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
      expect(mockPostSocialLogin).not.toHaveBeenCalled();
      expect(saveTokens).not.toHaveBeenCalled();
    }
  );

  it('동의 거부(access_denied): 실패가 아니라 취소 상태이고 서버 호출은 0회다', async () => {
    useWebNaverEnv();
    asWeb();
    popupReturns((state) => ({
      type: 'error',
      params: { error: 'access_denied', state },
    }));
    const { result } = renderLogin();

    act(() => {
      result.current.signIn('naver', makeAuthorize('naver'));
    });

    await waitFor(() => expect(result.current.phase).toBe('cancelled'));
    expect(result.current.errorCode).not.toBe('AUTHORIZE_FAILED');
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
  });
});

describe('버튼 노출 판정 — 웹은 CLIENT_ID 기준 (AC-W4-10)', () => {
  // 버튼 노출(LoginPage)과 makeAuthorize 가 같은 함수를 쓴다 — 둘이 갈라지면 버튼은 보이는데 누르면 던진다.
  it('웹: CLIENT_ID 만 있으면(스킴 없어도) 보인다', () => {
    useWebNaverEnv();
    asWeb();

    expect(isNaverLoginAvailable()).toBe(true);
  });

  it('웹: CLIENT_ID 가 없으면 숨긴다', () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '';
    asWeb();

    expect(isNaverLoginAvailable()).toBe(false);
  });

  it('웹: 스킴만 있고 CLIENT_ID 가 없으면 숨긴다 (스킴은 iOS SDK 용 키다)', () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '';
    process.env.EXPO_PUBLIC_NAVER_URL_SCHEME = 'fake-naver-scheme';
    asWeb();

    expect(isNaverLoginAvailable()).toBe(false);
  });

  it('웹: dev fake 인가면 아무 키가 없어도 보인다', () => {
    process.env.EXPO_PUBLIC_AUTH_FAKE = '1';
    asWeb();

    expect(isNaverLoginAvailable()).toBe(true);
  });

  it('iOS(대조): CLIENT_ID 만 있으면 숨긴다 — 스킴이 있어야 보이는 기존 규칙이다', () => {
    useWebNaverEnv();

    expect(isNaverLoginAvailable()).toBe(false);
  });
});
