import { AppleAuthenticationScope } from 'expo-apple-authentication';

import {
  appleSignInAsyncSpy,
  resetExpoAppleAuthenticationMock,
} from '@/test-support/expoAppleAuthenticationMock';
import {
  promptAsyncSpy,
  resetExpoAuthSessionMock,
} from '@/test-support/expoAuthSessionMock';

import { makeAuthorize } from './makeAuthorize';

/**
 * TRIP-932 AC-1~AC-4 — 애플 네이티브 인가 어댑터.
 *
 * 무엇을 보장하나: 애플 SDK(`signInAsync`)가 돌려준 것을 우리 코드가
 *  (1) 성공이면 identityToken → accessToken, authorizationCode 를 함께 담은 `success-token` 으로
 *      정규화하고 user·email·fullName 같은 여분은 버리며,
 *  (2) 이메일만 요청하고(Q1),
 *  (3) `.code === 'ERR_REQUEST_CANCELED'` 만 취소로 흡수하고 나머지 실패는 그대로 던지며(INV-4),
 *  (4) 브라우저 OAuth(expo-auth-session)로 새지 않는다.
 *
 * 진입점은 `makeAuthorize('apple')()` 다 — 어댑터 파일명을 테스트가 못박지 않는다. 목으로 바꾸는
 * 것은 SDK 모듈뿐이고 변환 로직은 진짜를 돌린다.
 *
 * 3동작: 준비(env + SDK 응답 주입) → 실행(makeAuthorize('apple')()) → 단언(AuthorizeResult).
 */

jest.mock(
  'expo-apple-authentication',
  () =>
    require('@/test-support/expoAppleAuthenticationMock')
      .expoAppleAuthenticationModule
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

const ENV_KEYS = ['EXPO_PUBLIC_AUTH_FAKE', 'EXPO_PUBLIC_AUTH_FAKE_OUTCOME'];
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  ORIGINAL_ENV[key] = process.env[key];
}

beforeEach(() => {
  // fake 토글이 켜져 있으면 apple 은 dev 전용 success-code 로 빠져 SDK 를 타지 않는다.
  process.env.EXPO_PUBLIC_AUTH_FAKE = '';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
  resetExpoAppleAuthenticationMock();
  resetExpoAuthSessionMock();
});

/** 애플이 실제로 돌려주는 credential 모양. 서버로 보낼 두 값 외에 여분이 함께 온다. */
function appleCredential(overrides: Record<string, unknown> = {}) {
  return {
    user: 'apple-user-001',
    identityToken: 'id-tok',
    authorizationCode: 'auth-code',
    email: 'x@privaterelay.appleid.com',
    fullName: { givenName: '길동', familyName: '홍' },
    realUserStatus: 1,
    state: null,
    ...overrides,
  };
}

/** Expo 모듈이 던지는 CodedError 모양 — `.code` 에 고정 문자열이 실린다. */
function codedError(code: string, message = 'apple sign-in error'): Error {
  return Object.assign(new Error(message), { code });
}

describe('AC-1 · 애플 성공 → identityToken·authorizationCode 를 담은 success-token', () => {
  it('identityToken 을 accessToken 으로, authorizationCode 를 그대로 옮기고 여분(user·email·fullName)은 버린다', async () => {
    // 준비
    appleSignInAsyncSpy.mockResolvedValue(appleCredential());

    // 실행
    const result = await makeAuthorize('apple')();

    // 단언 — 완전 일치(toStrictEqual). 여분 키나 undefined 키가 섞여도 실패한다.
    expect(result).toStrictEqual({
      type: 'success-token',
      accessToken: 'id-tok',
      authorizationCode: 'auth-code',
    });
    // 도달 앵커 — SDK 를 실제로 탔다.
    expect(appleSignInAsyncSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AC-2 · 요청 범위는 이메일만 (Q1)', () => {
  it('signInAsync 에 requestedScopes=[EMAIL] 을 넘기고 FULL_NAME 은 요청하지 않는다', async () => {
    // 준비
    appleSignInAsyncSpy.mockResolvedValue(appleCredential());

    // 실행
    await makeAuthorize('apple')();

    // 단언 — 범위만 본다(다른 옵션 키는 못박지 않는다).
    const options = appleSignInAsyncSpy.mock.calls[0][0];
    expect(options.requestedScopes).toEqual([AppleAuthenticationScope.EMAIL]);
  });
});

describe('AC-3 · 취소는 흡수하고 실패는 그대로 던진다 (BR-U0-06 · INV-4)', () => {
  it('code 가 ERR_REQUEST_CANCELED 이면 { type:"cancel" } 로 정규화한다', async () => {
    // 준비 — 사용자가 애플 시트에서 취소했다.
    appleSignInAsyncSpy.mockRejectedValue(
      codedError('ERR_REQUEST_CANCELED', 'The user canceled the request')
    );

    // 실행 + 단언
    await expect(makeAuthorize('apple')()).resolves.toStrictEqual({
      type: 'cancel',
    });
  });

  it('code 가 ERR_REQUEST_FAILED 이면 같은 에러 객체를 그대로 던진다 — 취소로 삼키지 않는다', async () => {
    // 준비
    const failure = codedError('ERR_REQUEST_FAILED');
    appleSignInAsyncSpy.mockRejectedValue(failure);

    // 실행 + 단언 — toBe(동일성): 새 Error 로 감싸 던지면 실패한다.
    await expect(makeAuthorize('apple')()).rejects.toBe(failure);
  });

  it('message 에만 ERR_REQUEST_CANCELED 가 있고 code 가 없으면 취소가 아니다 — 판정은 .code 로만', async () => {
    // 준비 — 카카오처럼 message 문자열로 판정하는 구현을 잡는다.
    const failure = new Error('ERR_REQUEST_CANCELED');
    appleSignInAsyncSpy.mockRejectedValue(failure);

    // 실행 + 단언
    await expect(makeAuthorize('apple')()).rejects.toBe(failure);
  });

  it.each(['identityToken', 'authorizationCode'])(
    '%s 가 null 이면 빈 토큰을 서버로 보내지 않고 실패로 던진다',
    async (field) => {
      // 준비 — 타입상 string | null 이다. 빈 값으로 success 를 만들면 안 된다.
      appleSignInAsyncSpy.mockResolvedValue(appleCredential({ [field]: null }));

      // 실행 + 단언
      await expect(makeAuthorize('apple')()).rejects.toThrow();
      // 도달 앵커 — SDK 를 실제로 타고 나서 던졌다(SDK 전에 다른 이유로 던지는 구현과 구분).
      expect(appleSignInAsyncSpy).toHaveBeenCalledTimes(1);
    }
  );
});

describe('AC-4 · 브라우저 OAuth 로 새지 않는다', () => {
  it('apple 성공 경로에서 expo-auth-session promptAsync 는 한 번도 불리지 않는다', async () => {
    // 준비
    appleSignInAsyncSpy.mockResolvedValue(appleCredential());

    // 실행
    await makeAuthorize('apple')();

    // 단언 — 대조: 브라우저 OAuth 경로를 타지 않았다.
    expect(promptAsyncSpy).not.toHaveBeenCalled();
    expect(appleSignInAsyncSpy).toHaveBeenCalledTimes(1);
  });
});
