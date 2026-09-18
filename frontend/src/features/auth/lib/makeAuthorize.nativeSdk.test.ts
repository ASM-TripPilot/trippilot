import {
  kakaoLoginSpy,
  naverInitializeSpy,
  naverLoginSpy,
  resetNativeSocialSdkMock,
} from '@/test-support/nativeSocialSdkMock';
import {
  promptAsyncSpy,
  resetExpoAuthSessionMock,
} from '@/test-support/expoAuthSessionMock';

import { makeAuthorize } from './makeAuthorize';

/**
 * AC-1(어댑터) · AC-2(어댑터) · AC-5 · AC-8′(런타임) — 네이티브 SDK 인가 어댑터.
 *
 * 무엇을 보장하나: 카카오·네이버 SDK 가 돌려준 것을 우리 코드가
 *  (1) 성공이면 `{ type:'success-token', accessToken }` 으로 정규화하고,
 *  (2) **형태가 서로 다른 두 취소**를 똑같이 `{ type:'cancel' }` 로 흡수하며,
 *  (3) 네이버 시크릿을 env 에서만 받고 결과에는 담지 않는다.
 *
 * 진입점을 `makeAuthorize(provider)()` 로 잡은 이유: 어댑터 **파일명·구현 형태를 테스트가 못박지
 * 않기 위함**이다(makeAuthorize.realOauth.test.ts 와 같은 형태). 목으로 바꾸는 것은 SDK 모듈뿐이고
 * 변환 로직은 진짜를 돌린다 — 어댑터를 통째로 jest.mock 하면 그 안이 사각지대가 되어 공허한
 * green 이 난다(직전 사이클 N-9 실측).
 *
 * expo-auth-session 3종도 함께 목킹한다(★D4): 구현 전 현행 makeAuthorize 는 kakao·naver 실경로에서
 * realAuthorize(expo-auth-session)로 가므로, 그 목이 없으면 red 가 **모듈 로드 크래시**로 나타나
 * 원인을 안 가리킨다. 목을 걸어 두면 red 가 `{type:'success'…}` vs `{type:'success-token'…}`
 * 단언 불일치로 찍힌다. promptAsyncSpy 미호출 단언은 덤으로 "웹 OAuth 로 새지 않았다"를 증명한다.
 *
 * 3동작: 준비(env + SDK 응답 주입) → 실행(makeAuthorize(provider)()) → 단언(AuthorizeResult).
 */

jest.mock(
  '@react-native-seoul/kakao-login',
  () => require('@/test-support/nativeSocialSdkMock').kakaoLoginModule,
  { virtual: true }
);
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

const ENV_KEYS = [
  'EXPO_PUBLIC_AUTH_FAKE',
  'EXPO_PUBLIC_AUTH_FAKE_OUTCOME',
  'EXPO_PUBLIC_KAKAO_CLIENT_ID',
  'EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY',
  'EXPO_PUBLIC_NAVER_CLIENT_ID',
  'EXPO_PUBLIC_NAVER_CLIENT_SECRET',
  'EXPO_PUBLIC_NAVER_URL_SCHEME',
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
  resetNativeSocialSdkMock();
  resetExpoAuthSessionMock();
});

/**
 * 카카오 실경로 진입 조건. 신규 네이티브 앱 키(D2)와 기존 clientId 를 **둘 다** 채운다 —
 * 구현자가 어느 쪽을 진입 게이트로 삼든 실경로로 들어가게 해서, 이 테스트가 게이트 형태를
 * 못박지 않도록 한다.
 */
function useKakaoSdkEnv(): void {
  process.env.EXPO_PUBLIC_AUTH_FAKE = '';
  process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID = 'test-kakao-client-id';
  process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY = 'test-kakao-native-app-key';
}

/** 네이버 실경로 진입 조건. consumerKey 는 기존 CLIENT_ID 재사용(D2). */
function useNaverSdkEnv(): void {
  process.env.EXPO_PUBLIC_AUTH_FAKE = '';
  process.env.EXPO_PUBLIC_NAVER_CLIENT_ID = 'test-naver-client-id';
  process.env.EXPO_PUBLIC_NAVER_CLIENT_SECRET = 'test-naver-client-secret';
  process.env.EXPO_PUBLIC_NAVER_URL_SCHEME = 'test-naver-url-scheme';
}

describe('AC-1(어댑터) · 카카오 SDK accessToken → success-token', () => {
  it('SDK login() 이 준 accessToken 을 { type:"success-token", accessToken } 으로 정규화한다', async () => {
    // 준비 — 카카오 SDK 가 토큰 묶음을 돌려주는 상태. accessToken 외 필드도 함께 준다
    // (실 SDK 는 refreshToken·idToken 등을 같이 준다 — 그 여분이 결과로 새면 안 된다).
    useKakaoSdkEnv();
    kakaoLoginSpy.mockResolvedValue({
      accessToken: 'kakao-access-token',
      refreshToken: 'kakao-refresh-token',
      idToken: 'kakao-id-token',
      scopes: ['profile_nickname'],
    });

    // 실행
    const result = await makeAuthorize('kakao')();

    // 단언 — 완전 일치. toMatchObject(부분 일치)로는 "여분 필드가 없다"를 못 잡는다.
    expect(result).toEqual({
      type: 'success-token',
      accessToken: 'kakao-access-token',
    });
    // 도달 앵커 — 실제로 SDK 를 탔다(설정 부재로 조용히 돌아 나오지 않았다).
    expect(kakaoLoginSpy).toHaveBeenCalledTimes(1);
    // 대조 — 브라우저 OAuth(code 경로)로 새지 않았다. 이 칸의 존재 이유가 redirect 회피다.
    expect(promptAsyncSpy).not.toHaveBeenCalled();
  });
});

describe('AC-2(어댑터) · 네이버 SDK accessToken → success-token', () => {
  it('successResponse.accessToken 을 { type:"success-token", accessToken } 으로 정규화한다', async () => {
    // 준비 — 네이버는 성공/실패를 **한 겹 감싼** 객체로 돌려준다.
    useNaverSdkEnv();
    naverLoginSpy.mockResolvedValue({
      isSuccess: true,
      successResponse: {
        accessToken: 'naver-access-token',
        refreshToken: 'naver-refresh-token',
        tokenType: 'bearer',
      },
    });

    // 실행
    const result = await makeAuthorize('naver')();

    // 단언
    expect(result).toEqual({
      type: 'success-token',
      accessToken: 'naver-access-token',
    });
    expect(naverLoginSpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy).not.toHaveBeenCalled();
  });
});

// ── ★ 이 사이클의 핵심 쌍 ────────────────────────────────────────────────
// 두 SDK 는 취소를 **다른 신호**로 알린다: 카카오는 reject(에러를 던짐), 네이버는 resolve
// (정상 반환인데 플래그로 알림). 한쪽만 맞추면 다른 쪽 취소가 phase='error' 로 새어 사용자에게
// 실패 배너가 뜬다(BR-U0-06 · INV-4 위반). 두 케이스를 나란히 둬서 한쪽만 구현하면 즉시 red 다.

// ── 카카오: 취소와 진짜 실패가 **같은 reject 채널**을 쓴다 ──────────────────
// 판별 근거는 SDK 소스 실측이다(@react-native-seoul/kakao-login@6.0.3
// ios/RNKakaoLogins/RNKakaoLogins.swift):
//   - `:163`·`:180`·`:210` 이 전부 `reject("RNKakaoLogins", describe(error), error)` 로 거부한다
//     → **에러 코드는 항상 "RNKakaoLogins" 하나**이고 구분 정보는 message 문자열에만 있다.
//   - `:85-100` `describe(_:)` 가 message 를 고정 포맷으로 만든다:
//     `ClientFailed(<reason>): <msg>` / `ApiFailed(...)` / `AuthFailed(...)` / `AppsFailed(...)`
//   - `:108-118` 이 `case .Cancelled = sdkError.getClientError().reason` 으로 취소를 가른다
//     → 사용자 취소는 `ClientFailed(Cancelled): …` 형태로 실려 나온다.
//   - Android(RNKakaoLoginsModule.kt)도 `promise.reject("RNKakaoLogins", error.message, error)` 로 동형.
// 아래 세 케이스가 한 벌이다: Cancelled 만 취소로 삼키고, 나머지 reject 는 삼키지 않는다.
//
// ⚠️ 천장 — 이 판별은 **문자열 매칭**이라 SDK 가 describe() 포맷을 바꾸면 조용히 깨진다(취소가
// 실패로 표시되거나 그 반대). 타입 있는 신호가 SDK 에 없어 현재로선 이것이 최선이고, 실기 확인
// (L2)이 마지막 그물이다. 구현자는 이 천장을 `ponytail:` 주석으로 남길 것.

describe('AC-5 · 취소 흡수 — 카카오 취소는 ClientFailed(Cancelled) reject 로 온다', () => {
  it('message 가 ClientFailed(Cancelled) 형태면 에러를 밖으로 흘리지 않고 { type:"cancel" } 로 정규화한다', async () => {
    // 준비 — 실 SDK 가 사용자 취소에 만들어 내는 message 포맷 그대로.
    useKakaoSdkEnv();
    kakaoLoginSpy.mockRejectedValue(
      new Error('ClientFailed(Cancelled): user cancelled login')
    );

    // 실행
    const result = await makeAuthorize('kakao')();

    // 단언 — 완전 일치. 에러가 그대로 새면 훅이 phase='error' 로 보내 실패 배너가 뜬다.
    expect(result).toEqual({ type: 'cancel' });
    expect(kakaoLoginSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AC-5 · INV-4 — 카카오의 진짜 실패는 취소로 삼켜지지 않는다', () => {
  /**
   * 인가 결과가 cancel/dismiss 로 resolve 되면 훅이 phase='cancelled' 로 보내 화면에서 **조용히
   * 사라진다**(침묵 실패). 그래서 "취소가 아니다"를 이렇게 관측한다: resolve 면 그 type 을,
   * reject 면 'rejected' 를 남겨 한 값으로 비교한다 — 실패 시 diff 에 실제 결말이 찍힌다.
   * D1 유니온에는 실패를 표현하는 멤버가 없으므로 사실상 reject 가 유일한 INV-4 준수 경로다.
   */
  async function settle(provider: 'kakao' | 'naver'): Promise<string> {
    return makeAuthorize(provider)().then(
      (value) => value.type,
      () => 'rejected'
    );
  }

  it('네트워크 실패(ApiFailed)는 cancel 로 바뀌지 않는다 — 조용히 사라지면 INV-4 위반이다', async () => {
    // 준비 — 취소가 아닌 진짜 실패. 위 케이스와 **한 벌**이다: 이 둘이 갈려야 판별이 실재한다
    // (전부 cancel 로 만들면 위가, 전부 reject 로 만들면 이 케이스가 잡는다).
    useKakaoSdkEnv();
    kakaoLoginSpy.mockRejectedValue(
      new Error('ApiFailed(Unknown): network is down')
    );

    // 실행
    const settled = await settle('kakao');

    // 도달 앵커 — SDK 를 실제로 탔다. 이게 없으면 "SDK 를 아예 안 부르고 웹 OAuth 로 새는"
    // 현행 구현에서도 결과가 'success' 라 not.toBe('cancel') 이 **공허하게 통과한다**.
    expect(kakaoLoginSpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy).not.toHaveBeenCalled();

    // 단언 — 사용자에게 실패가 보여야 한다.
    expect(settled).not.toBe('cancel');
    expect(settled).not.toBe('dismiss');
  });

  it('취소가 아닌 ClientFailed(TokenNotFound)도 cancel 이 아니다 — 판별 기준은 접두어가 아니라 Cancelled 다', async () => {
    // 준비 — `ClientFailed` 접두어만 보고 취소로 판정하는 구현을 잡는 대조군. 실 SDK 의
    // ClientFailed 는 reason 이 Cancelled 가 아닌 경우(TokenNotFound 등)도 낸다.
    useKakaoSdkEnv();
    kakaoLoginSpy.mockRejectedValue(
      new Error('ClientFailed(TokenNotFound): token not found')
    );

    // 실행
    const settled = await settle('kakao');

    // 도달 앵커 — 위 케이스와 같은 이유(공허한 통과 방지).
    expect(kakaoLoginSpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy).not.toHaveBeenCalled();

    // 단언
    expect(settled).not.toBe('cancel');
    expect(settled).not.toBe('dismiss');
  });

  // ── 오탐 방향(취소가 아닌데 취소로 오해) — code-critic 뮤테이션 B 근거 ──────────
  // 위 두 케이스는 `Cancelled` 라는 낱말이 **아예 없는** 문자열이라, 판별을 아무리 헐겁게
  // 만들어도(예: /cancel/i) 통과한다(실측 130/130 green). 아래 둘이 그 반대 방향을 막는다.
  // `describe()` 의 콜론 뒤 <msg> 는 **카카오 서버가 주는 자유 문장**이라 취소가 아닌 에러의
  // 설명문에 `cancel`·`Cancelled` 가 섞여 들어올 수 있다(SDK 소스 실측).

  it('취소 낱말이 소문자로 섞인 비-취소 메시지는 cancel 이 아니다 — 판별을 /cancel/i 로 넓히면 red', async () => {
    // 준비 — 취소 포맷이 **아닌데**(ApiFailed) 설명문에 'cancelled' 가 들어 있다.
    useKakaoSdkEnv();
    kakaoLoginSpy.mockRejectedValue(
      new Error('ApiFailed(Unknown): request was cancelled by upstream')
    );

    // 실행
    const settled = await settle('kakao');

    // 도달 앵커
    expect(kakaoLoginSpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy).not.toHaveBeenCalled();

    // 단언 — 서버 사정으로 끊긴 것이지 사용자가 취소한 게 아니다.
    expect(settled).not.toBe('cancel');
    expect(settled).not.toBe('dismiss');
  });

  it('취소 낱말이 대문자로 섞여 있어도 ClientFailed(Cancelled) 포맷이 아니면 cancel 이 아니다', async () => {
    // 준비 — 대문자 `Cancelled` 가 들어 있지만 **취소 포맷이 아니다**(ApiFailed).
    // 판별이 "문자열 어딘가에 Cancelled 가 있나"면 여기서 오탐한다 — 취소 판별은
    // `ClientFailed(Cancelled)` **포맷**을 겨눠야 한다(SDK 의 취소 표현이 그것뿐이다).
    useKakaoSdkEnv();
    kakaoLoginSpy.mockRejectedValue(
      new Error('ApiFailed(Unknown): upstream request Cancelled by server')
    );

    // 실행
    const settled = await settle('kakao');

    // 도달 앵커
    expect(kakaoLoginSpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy).not.toHaveBeenCalled();

    // 단언
    expect(settled).not.toBe('cancel');
    expect(settled).not.toBe('dismiss');
  });

  // ── 네이버 쪽 짝 — 카카오에만 있던 INV-4 심판을 대칭으로 세운다 ─────────────
  // code-critic 뮤테이션 A: 네이버 실패를 전부 cancel 로 삼켜도 273/273 green 이었다.
  // 카카오에는 위 짝이 있는데 네이버에만 없어서 생긴 비대칭이다.

  it('네이버의 진짜 실패(isCancel:false)는 cancel 로 삼켜지지 않는다 — 카카오 짝과 대칭', async () => {
    // 준비 — 취소가 **아닌** 실패다: isSuccess:false 이지만 isCancel 이 참이 아니다.
    // 실기에서 이 경로는 비행기 모드·서버 거부에서 나온다.
    useNaverSdkEnv();
    naverLoginSpy.mockResolvedValue({
      isSuccess: false,
      failureResponse: {
        isCancel: false,
        message: 'network error',
      },
    });

    // 실행
    const settled = await settle('naver');

    // 도달 앵커 — 네이버 SDK 를 실제로 탔다(웹 OAuth 로 새면 결과가 'success' 라 아래가 공허해진다).
    expect(naverLoginSpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy).not.toHaveBeenCalled();

    // 단언 — 삼켜지면 errorCode 가 null 인 채 phase='cancelled' 로 끝나 화면에 아무 안내도
    // 남지 않는다(INV-4 침묵 실패).
    expect(settled).not.toBe('cancel');
    expect(settled).not.toBe('dismiss');
  });
});

describe('AC-5 · 취소 흡수 — 네이버는 resolve + isCancel 플래그로 온다', () => {
  it('isSuccess:false + failureResponse.isCancel:true 를 { type:"cancel" } 로 정규화한다', async () => {
    // 준비 — 네이버 취소는 "정상 반환"이다. 던지지 않는다.
    useNaverSdkEnv();
    naverLoginSpy.mockResolvedValue({
      isSuccess: false,
      failureResponse: {
        isCancel: true,
        message: 'user_cancel',
      },
    });

    // 실행
    const result = await makeAuthorize('naver')();

    // 단언 — 카카오와 **글자 단위로 같은 결과**여야 훅이 두 provider 를 똑같이 다룬다.
    expect(result).toEqual({ type: 'cancel' });
    expect(naverLoginSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AC-8′ · 네이버 시크릿은 env 에서만 오고 결과에 담기지 않는다 (D5 예외)', () => {
  it('initialize 가 env 값 그대로의 consumerKey·consumerSecret 을 받고, 결과에는 시크릿 키가 없다', async () => {
    // 준비 — env 에 넣은 값과 같은 값이 SDK 로 전달되면 "env 경유"가 증명된다(하드코딩이면
    // 다른 값이 나온다).
    useNaverSdkEnv();
    naverLoginSpy.mockResolvedValue({
      isSuccess: true,
      successResponse: { accessToken: 'naver-access-token' },
    });

    // 실행 — 이 테스트 안에서 반드시 한 번 로그인을 태운다(초기화가 로그인 시점에 일어나는
    // 구현도 관측되도록).
    const result = await makeAuthorize('naver')();

    // 단언 — objectContaining 이라 appName·serviceUrlSchemeIOS 등 나머지 파라미터는 자유다.
    // ⚠️ 이 스파이는 afterEach 에서 지우지 않는다(★D8): 초기화를 모듈 스코프에서 한 번만
    // 부르는 메모이즈 구현이면 매번 지울 때 실행 순서에 따라 기록이 비어 버린다.
    expect(naverInitializeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        consumerKey: 'test-naver-client-id',
        consumerSecret: 'test-naver-client-secret',
      })
    );

    // 단언 — 서버로 나갈 결과 객체에는 시크릿이 없다(SEC-AUTH). accessToken 존재를 함께
    // 확인해 "빈 객체라서 통과"하는 공허한 green 을 막는다.
    const keys = Object.keys(result).map((k) => k.toLowerCase());
    expect(keys).toContain('accesstoken');
    expect(keys).not.toContain('consumersecret');
    expect(keys).not.toContain('clientsecret');
    expect(keys).not.toContain('client_secret');
    expect(keys).not.toContain('secret');
  });

  it('initialize 가 login 보다 **먼저** 불린다 — 설정 전에 로그인하면 실기에서 곧바로 실패한다', async () => {
    // 준비 — code-critic 뮤테이션 E: initialize 블록을 login 아래로 옮겨도 7/7 green 이었다.
    // 위 케이스의 `toHaveBeenCalledWith` 는 "한 번이라도 이 인자로 불렸나"만 보고 **순서를
    // 못 본다**. 실기에서는 consumerKey·consumerSecret 이 아직 안 실린 채 로그인 창이 떠서
    // 곧바로 실패한다.
    useNaverSdkEnv();
    naverLoginSpy.mockResolvedValue({
      isSuccess: true,
      successResponse: { accessToken: 'naver-access-token' },
    });

    // 실행
    await makeAuthorize('naver')();

    // 단언 — jest 의 invocationCallOrder 는 **모든 목에 걸친 전역 호출 순번**이라 서로 다른
    // 스파이 사이의 선후를 비교할 수 있다.
    //
    // ⚠️ initialize 스파이는 afterEach 에서 지우지 않으므로(★D8) 기록이 이전 테스트까지
    // 누적돼 있다. 그래서 `[0]`(최초 호출)이 아니라 **마지막 호출**을 쓴다 — 이 형태라야
    // 메모이즈 구현(초기화가 앞선 테스트에서 한 번만 일어남)에서도 성립하면서,
    // "login 뒤에 initialize" 뮤테이션은 마지막 initialize 가 login 보다 뒤로 밀려 잡힌다.
    const initOrders = naverInitializeSpy.mock.invocationCallOrder;
    expect(initOrders.length).toBeGreaterThan(0);
    expect(naverLoginSpy.mock.invocationCallOrder).toHaveLength(1);

    const lastInitialize = initOrders[initOrders.length - 1];
    const loginCall = naverLoginSpy.mock.invocationCallOrder[0];
    expect(lastInitialize).toBeLessThan(loginCall);
  });
});
