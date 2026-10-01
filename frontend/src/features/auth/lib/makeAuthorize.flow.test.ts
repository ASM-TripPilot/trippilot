import type { SocialProvider } from '@/shared/api';
import {
  appleSignInAsyncSpy,
  resetExpoAppleAuthenticationMock,
} from '@/test-support/expoAppleAuthenticationMock';
import {
  promptAsyncSpy,
  resetExpoAuthSessionMock,
} from '@/test-support/expoAuthSessionMock';
import {
  kakaoLoginSpy,
  naverLoginSpy,
  resetNativeSocialSdkMock,
} from '@/test-support/nativeSocialSdkMock';

import { makeAuthorize } from './makeAuthorize';

/**
 * TRIP-1035 — `makeAuthorize(provider).flow` 는 "이번 인가가 어느 갈래로 갈지"를 인가 **전에**
 * 알려 준다. 훅은 이 값이 'code' 면 authorize() 전에 연령 시트를 띄운다.
 *
 * 무엇을 보장하나(행마다 세 가지):
 *  (1) env 조합별로 flow 가 기대값이다 — 제공자 이름이 아니라 env 가 갈래를 정한다(네이버·카카오는
 *      SDK env 유무로, fake 토글이 켜지면 전부 code),
 *  (2) flow 를 읽는 순간에는 어떤 어댑터도 불리지 않았다 — 알아내려고 인가를 한 번 돌려 보는
 *      구현(브라우저 창이 뜬다)을 잡는다,
 *  (3) 같은 env 에서 실제로 인가하면 결과 type 이 flow 와 짝이 맞는다 — 판정과 분기가 **같은
 *      출처**라는 증거. 조건을 두 곳에 베껴 쓰면 지금은 맞아도 한쪽만 바뀌는 순간 이 짝이 깨진다.
 *
 * env 는 매 행 시작에 전부 지우고 그 행의 것만 세운다 — flow 를 모듈 로드 시점에 한 번 계산하는
 * 구현을 잡고, 로컬 .env 값이 새어 들지 않게 한다.
 *
 * 어댑터 모듈(SDK·expo-auth-session)은 기존 makeAuthorize.*.test.ts 와 같은 목을 쓴다 — 변환
 * 로직은 진짜를 돌린다.
 *
 * 3동작: 준비(env + SDK 응답) → 실행(makeAuthorize(p) → .flow 읽기 → 호출) → 단언(flow · 스파이 · 결과 type).
 */

jest.mock(
  'expo-apple-authentication',
  () =>
    require('@/test-support/expoAppleAuthenticationMock')
      .expoAppleAuthenticationModule
);
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
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_REDIRECT_URI',
  'EXPO_PUBLIC_KAKAO_CLIENT_ID',
  'EXPO_PUBLIC_KAKAO_REDIRECT_URI',
  'EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY',
  'EXPO_PUBLIC_NAVER_CLIENT_ID',
  'EXPO_PUBLIC_NAVER_CLIENT_SECRET',
  'EXPO_PUBLIC_NAVER_REDIRECT_URI',
  'EXPO_PUBLIC_NAVER_URL_SCHEME',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  ORIGINAL_ENV[key] = process.env[key];
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  // 어댑터가 실제로 불렸을 때 돌려줄 성공 응답(각 SDK 의 실제 모양).
  kakaoLoginSpy.mockResolvedValue({ accessToken: 'kakao-access-token' });
  naverLoginSpy.mockResolvedValue({
    isSuccess: true,
    successResponse: { accessToken: 'naver-access-token' },
  });
  appleSignInAsyncSpy.mockResolvedValue({
    user: 'apple-user-001',
    identityToken: 'apple-id-token',
    authorizationCode: 'apple-auth-code',
  });
});

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
  resetExpoAppleAuthenticationMock();
});

type Row = {
  label: string;
  provider: SocialProvider;
  env: Partial<Record<(typeof ENV_KEYS)[number], string>>;
  flow: 'code' | 'token';
};

const ROWS: Row[] = [
  // fake 토글 — provider 와 무관하게 항상 success-code(dev 전용 경로).
  {
    label: 'fake 토글 ON',
    provider: 'google',
    env: { EXPO_PUBLIC_AUTH_FAKE: '1' },
    flow: 'code',
  },
  {
    label: 'fake 토글 ON',
    provider: 'kakao',
    env: { EXPO_PUBLIC_AUTH_FAKE: '1' },
    flow: 'code',
  },
  {
    label: 'fake 토글 ON',
    provider: 'naver',
    env: { EXPO_PUBLIC_AUTH_FAKE: '1' },
    flow: 'code',
  },
  {
    label: 'fake 토글 ON',
    provider: 'apple',
    env: { EXPO_PUBLIC_AUTH_FAKE: '1' },
    flow: 'code',
  },
  // 실 빌드 — google 은 SDK 분기가 없어 항상 브라우저 OAuth.
  {
    label: '실 · google clientId',
    provider: 'google',
    env: {
      EXPO_PUBLIC_GOOGLE_CLIENT_ID: 'test-google-client-id',
      EXPO_PUBLIC_GOOGLE_REDIRECT_URI: 'trippilot://oauth/google',
    },
    flow: 'code',
  },
  // 실 빌드 — apple 은 env 게이트 없이 항상 네이티브 SDK.
  { label: '실 · apple', provider: 'apple', env: {}, flow: 'token' },
  // 실 빌드 — kakao 는 네이티브 앱 키 유무로 갈린다.
  {
    label: '실 · kakao 네이티브 키 있음',
    provider: 'kakao',
    env: {
      EXPO_PUBLIC_KAKAO_CLIENT_ID: 'test-kakao-client-id',
      EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY: 'test-kakao-native-app-key',
    },
    flow: 'token',
  },
  {
    label: '실 · kakao 네이티브 키 없음',
    provider: 'kakao',
    env: { EXPO_PUBLIC_KAKAO_CLIENT_ID: 'test-kakao-client-id' },
    flow: 'code',
  },
  // 실 빌드 — naver 는 URL 스킴 유무로 갈린다(지금 로컬 .env.local 은 스킴이 없어 code).
  {
    label: '실 · naver URL 스킴 있음',
    provider: 'naver',
    env: {
      EXPO_PUBLIC_NAVER_CLIENT_ID: 'test-naver-client-id',
      EXPO_PUBLIC_NAVER_CLIENT_SECRET: 'test-naver-client-secret',
      EXPO_PUBLIC_NAVER_URL_SCHEME: 'test-naver-url-scheme',
    },
    flow: 'token',
  },
  {
    label: '실 · naver URL 스킴 없음',
    provider: 'naver',
    env: { EXPO_PUBLIC_NAVER_CLIENT_ID: 'test-naver-client-id' },
    flow: 'code',
  },
];

describe('TRIP-1035 · makeAuthorize(provider).flow — 갈래 판정은 실제 분기와 같은 출처다', () => {
  it.each(ROWS)(
    '$label · $provider → flow=$flow 이고, 실제 인가 결과도 그 갈래다',
    async ({ label, provider, env, flow }) => {
      // 준비
      Object.assign(process.env, env);

      // 실행 1 — 인가 함수를 만들고 표지만 읽는다(아직 인가하지 않는다).
      const authorize = makeAuthorize(provider);
      const observedFlow = authorize.flow;

      // 단언 (1)(2) — 인가 전에 갈래를 안다.
      expect(observedFlow).toBe(flow);
      expect(promptAsyncSpy).not.toHaveBeenCalled();
      expect(kakaoLoginSpy).not.toHaveBeenCalled();
      expect(naverLoginSpy).not.toHaveBeenCalled();
      expect(appleSignInAsyncSpy).not.toHaveBeenCalled();

      // 실행 2 — 같은 env 에서 실제로 인가한다.
      const result = await authorize();

      // 단언 (3) — 판정과 실제 결과가 짝이다.
      expect(result.type).toBe(
        flow === 'code' ? 'success-code' : 'success-token'
      );

      // 단언 (4) — 실 빌드 행은 어댑터가 정확히 1회(인가를 미리 돌리는 구현이면 2회). fake 행은 어댑터를 안 탄다.
      const adapterCalls = [
        promptAsyncSpy,
        kakaoLoginSpy,
        naverLoginSpy,
        appleSignInAsyncSpy,
      ].reduce((n, spy) => n + spy.mock.calls.length, 0);
      expect(adapterCalls).toBe(label.startsWith('fake') ? 0 : 1);
    }
  );
});
