import { StyleSheet } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import {
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
  AppleAuthenticationScope,
} from 'expo-apple-authentication';

import { postSocialLogin, postSocialTokenLogin } from '@/shared/api';
import {
  appleButtonPropsSpy,
  appleIsAvailableAsyncSpy,
  appleSignInAsyncSpy,
  resetExpoAppleAuthenticationMock,
} from '@/test-support/expoAppleAuthenticationMock';
import { LoginPage } from './LoginPage';

/**
 * TRIP-932 AC-9·AC-12·AC-13·AC-Q3 — LoginPage 애플 배선(컨테이너 → lazy 애플 모듈 → 화면 → 훅).
 *
 * 무엇을 보장하나: `(auth)/login` 컨테이너가
 *  (13) `isAvailableAsync()` 결과대로 애플 버튼을 넣거나 빼고(true=4버튼, false=3버튼),
 *  (12) 판정 전·판정 실패에는 숨기며(Q2 fail-closed),
 *  (Q3) 애플 자리에 SDK **공식** 버튼(CONTINUE · 반경 12 · 높이 52)을 그리고,
 *  (13·6) 그 버튼을 누르면 실 makeAuthorize → 실 useSocialLogin 을 거쳐 `/token` 으로
 *        identityToken·authorizationCode 를 보내고 게이트('/')로 복귀하며,
 *  (9) 애플 취소는 취소 안내(배너 없음), 애플 실패는 에러 배너로 드러난다.
 *
 * ⚠️ 이 파일은 `.integration` 이 아니라 node 버킷이다(02a ★2). 애플 모듈은 `await import` 로만
 * 닿는데, integration 버킷(--experimental-vm-modules 없음)에서는 `import()` 가 호출 자리에서 동기
 * TypeError 로 터진다. 그래서 MSW 대신 `@/shared/api` 를 목킹해 서버 경계를 관찰한다.
 *
 * 목으로 바꾸는 것은 SDK 모듈·서버 함수·저장소·라우터뿐이다. makeAuthorize·useSocialLogin·
 * SocialLoginScreen·애플 어댑터는 진짜를 돌린다.
 *
 * 3동작: 준비(가용성·SDK 응답·서버 응답 주입) → 실행(render / 버튼 press) → 단언(화면·호출 인자).
 */

jest.mock(
  'expo-apple-authentication',
  () =>
    require('@/test-support/expoAppleAuthenticationMock')
      .expoAppleAuthenticationModule
);
jest.mock('@gorhom/bottom-sheet');
jest.mock('@/shared/api', () => ({
  postSocialLogin: jest.fn(),
  postSocialTokenLogin: jest.fn(),
}));
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-router', () => {
  const replace = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ replace, push: jest.fn(), back: jest.fn() }),
    router: { replace, push: jest.fn(), back: jest.fn() },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockReplace = require('expo-router').router.replace as jest.Mock;
const mockPostSocialLogin = postSocialLogin as jest.MockedFunction<
  typeof postSocialLogin
>;
const mockPostSocialTokenLogin = postSocialTokenLogin as jest.MockedFunction<
  typeof postSocialTokenLogin
>;

const ENV_KEYS = ['EXPO_PUBLIC_AUTH_FAKE', 'EXPO_PUBLIC_AUTH_FAKE_OUTCOME'];
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  ORIGINAL_ENV[key] = process.env[key];
}

beforeEach(() => {
  // fake 토글을 끈다 — 켜져 있으면 apple 이 dev 전용 success-code 로 빠져 SDK 를 타지 않는다.
  process.env.EXPO_PUBLIC_AUTH_FAKE = '';
  mockReplace.mockClear();
  mockPostSocialLogin.mockReset();
  mockPostSocialTokenLogin.mockReset();
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
});

/** 보이는 소셜 버튼 testID 를 화면 순서대로(02a ★9). */
function socialButtonOrder(): string[] {
  return screen
    .getAllByTestId(/^auth-login-(google|apple|kakao|naver)$/)
    .map((node) => node.props.testID as string);
}

/**
 * 가용성 판정의 비동기 체인(lazy import → isAvailableAsync → setState)을 끝까지 흘려보낸다.
 * false 를 받은 **뒤에** 잘못 버튼을 띄우는 구현을 잡으려면 이게 있어야 한다(02a ★13).
 */
async function settle(): Promise<void> {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

/** 가용성 판정이 실제로 시작될 때까지 기다린다(판정을 isAvailableAsync 로 한다는 seed 결정). */
async function waitForAvailabilityCheck(): Promise<void> {
  await waitFor(() => expect(appleIsAvailableAsyncSpy).toHaveBeenCalled());
}

function appleCredential() {
  return {
    user: 'apple-user-001',
    identityToken: 'id-tok',
    authorizationCode: 'auth-code',
    email: 'x@privaterelay.appleid.com',
    fullName: null,
    realUserStatus: 1,
    state: null,
  };
}

function tokenPair() {
  return {
    accessToken: 'server-access-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshToken: 'server-refresh-token',
    refreshExpiresIn: 7776000,
    isNewUser: false,
    account: {
      accountId: '00000000-0000-0000-0000-000000000001',
      status: 'ACTIVE',
      email: null,
      socialProviders: ['APPLE'],
      onboardingCompleted: true,
    },
  };
}

function codedError(code: string): Error {
  return Object.assign(new Error('apple sign-in error'), { code });
}

/** iOS 모양으로 렌더하고 공식 버튼(대역)이 나타날 때까지 기다린다. */
async function renderIosAndWaitForApple() {
  appleIsAvailableAsyncSpy.mockResolvedValue(true);
  render(<LoginPage />);
  await screen.findByTestId('mock-apple-auth-button');
}

describe('AC-13 · 가용성 판정대로 애플 버튼을 넣고 뺀다', () => {
  it('isAvailableAsync 가 true 면(iOS) 구글·애플·카카오·네이버 4버튼이 이 순서로 보인다', async () => {
    // 준비
    appleIsAvailableAsyncSpy.mockResolvedValue(true);

    // 실행
    render(<LoginPage />);

    // 단언 — 래퍼 안에 공식 버튼(대역)이 들어온 뒤의 순서. 래퍼만 보면 옛 커스텀 버튼도 통과한다.
    const apple = await screen.findByTestId('auth-login-apple');
    await waitFor(() =>
      expect(
        within(apple).getByTestId('mock-apple-auth-button')
      ).toBeOnTheScreen()
    );
    expect(socialButtonOrder()).toEqual([
      'auth-login-google',
      'auth-login-apple',
      'auth-login-kakao',
      'auth-login-naver',
    ]);
  });

  it('isAvailableAsync 가 false 면(Android) 판정이 끝난 뒤에도 애플 없이 3버튼이다', async () => {
    // 준비
    appleIsAvailableAsyncSpy.mockResolvedValue(false);

    // 실행
    render(<LoginPage />);
    await waitForAvailabilityCheck();
    await settle();

    // 단언
    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    expect(socialButtonOrder()).toEqual([
      'auth-login-google',
      'auth-login-kakao',
      'auth-login-naver',
    ]);
    expect(screen.queryByTestId('auth-login-apple')).toBeNull();
  });
});

describe('AC-12 · 판정 전·판정 실패에는 숨긴다 (Q2 fail-closed)', () => {
  it('판정이 끝나지 않은 동안에는 애플 버튼이 없다', async () => {
    // 준비 — 영원히 끝나지 않는 판정.
    appleIsAvailableAsyncSpy.mockReturnValue(new Promise<boolean>(() => {}));

    // 실행
    render(<LoginPage />);
    await waitForAvailabilityCheck();

    // 단언
    expect(socialButtonOrder()).toEqual([
      'auth-login-google',
      'auth-login-kakao',
      'auth-login-naver',
    ]);
    expect(screen.queryByTestId('auth-login-apple')).toBeNull();
  });

  it('판정이 reject 되어도 화면은 죽지 않고 애플 없이 3버튼으로 남는다', async () => {
    // 준비
    appleIsAvailableAsyncSpy.mockRejectedValue(new Error('availability boom'));

    // 실행
    render(<LoginPage />);
    await waitForAvailabilityCheck();
    await settle();

    // 단언
    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    expect(socialButtonOrder()).toEqual([
      'auth-login-google',
      'auth-login-kakao',
      'auth-login-naver',
    ]);
    expect(screen.queryByTestId('auth-login-apple')).toBeNull();
  });
});

describe('AC-Q3 · 애플 자리는 SDK 공식 버튼이다 (HIG · 심사 가이드라인 4.8)', () => {
  it('공식 버튼을 CONTINUE · WHITE_OUTLINE 또는 BLACK · 반경 12 · 높이 52 로 그리고, 커스텀 아이콘·라벨은 없다', async () => {
    // 준비 + 실행
    await renderIosAndWaitForApple();

    // 단언 — 래퍼 안에 공식 버튼(대역)이 실제로 있다.
    const apple = screen.getByTestId('auth-login-apple');
    expect(
      within(apple).getByTestId('mock-apple-auth-button')
    ).toBeOnTheScreen();

    // 단언 — 공식 버튼이 받은 props(마지막 렌더 기준).
    const props = appleButtonPropsSpy.mock.calls.at(-1)?.[0] ?? {};
    expect(props.buttonType).toBe(AppleAuthenticationButtonType.CONTINUE);
    expect([
      AppleAuthenticationButtonStyle.WHITE_OUTLINE,
      AppleAuthenticationButtonStyle.BLACK,
    ]).toContain(props.buttonStyle);
    expect(props.cornerRadius).toBe(12);
    // 높이는 style 로만 먹는다(네이티브 뷰라 className 이 적용되지 않는다, ★12).
    expect(StyleSheet.flatten(props.style)?.height).toBe(52);

    // 단언 — 커스텀 사과 아이콘·음차 라벨은 없다.
    expect(screen.queryByTestId('auth-login-apple-icon')).toBeNull();
    expect(screen.queryByText('애플로 계속하기')).toBeNull();
  });
});

describe('AC-13·AC-6 · 공식 버튼을 누르면 /token 으로 identityToken·authorizationCode 를 보내고 게이트로 간다', () => {
  it('signInAsync(EMAIL) → postSocialTokenLogin("apple", { accessToken, authorizationCode }) → router.replace("/")', async () => {
    // 준비
    appleSignInAsyncSpy.mockResolvedValue(appleCredential());
    mockPostSocialTokenLogin.mockResolvedValue(tokenPair());
    await renderIosAndWaitForApple();

    // 실행
    fireEvent.press(screen.getByTestId('mock-apple-auth-button'));

    // 단언
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(appleSignInAsyncSpy.mock.calls[0][0].requestedScopes).toEqual([
      AppleAuthenticationScope.EMAIL,
    ]);
    expect(mockPostSocialTokenLogin.mock.calls[0]).toStrictEqual([
      'apple',
      { accessToken: 'id-tok', authorizationCode: 'auth-code' },
    ]);
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
  });
});

describe('AC-9 · 애플 취소·실패의 화면 표면', () => {
  it('ERR_REQUEST_CANCELED 는 취소 안내만 띄우고 에러 배너도 서버 호출도 없다', async () => {
    // 준비
    appleSignInAsyncSpy.mockRejectedValue(codedError('ERR_REQUEST_CANCELED'));
    await renderIosAndWaitForApple();

    // 실행
    fireEvent.press(screen.getByTestId('mock-apple-auth-button'));

    // 단언 — 짝: 안내는 있고 배너는 없다(★17).
    await waitFor(() =>
      expect(screen.getByTestId('auth-login-cancel-notice')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('auth-login-error-banner')).toBeNull();
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
    expect(appleSignInAsyncSpy).toHaveBeenCalledTimes(1);
  });

  it('ERR_REQUEST_FAILED 는 에러 배너로 드러나고 서버 호출은 없다 (INV-4)', async () => {
    // 준비
    appleSignInAsyncSpy.mockRejectedValue(codedError('ERR_REQUEST_FAILED'));
    await renderIosAndWaitForApple();

    // 실행
    fireEvent.press(screen.getByTestId('mock-apple-auth-button'));

    // 단언
    await waitFor(() =>
      expect(screen.getByTestId('auth-login-error-banner')).toBeOnTheScreen()
    );
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
    expect(appleSignInAsyncSpy).toHaveBeenCalledTimes(1);
  });
});
