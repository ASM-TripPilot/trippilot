import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { postSocialLogin, postSocialTokenLogin } from '@/shared/api';
import { saveTokens } from '@/shared/storage';
import { useSocialLogin, type AuthorizeResult } from './useSocialLogin';

/**
 * AC-1(훅) · AC-2(훅) · AC-3 · AC-4 · AC-5(훅) — SDK 토큰 경로의 갈래 분기.
 *
 * 무엇을 보장하나: 인가 결과의 갈래에 따라 훅이
 *  (1) 토큰 갈래(kakao·naver)면 `/token` 호출자만 부르고 code 호출자는 부르지 않으며,
 *  (2) 신규 가입이면 토큰을 커밋하지 않고 **같은 accessToken 을 `/token` 으로** 재전송하고,
 *  (3) code 갈래(google)면 기존 경로만 부르며 `/token` 으로 새지 않고,
 *  (4) 취소면 어느 쪽도 부르지 않는다.
 *
 * 두 엔드포인트 함수를 **나란히 목으로 세우는 것**이 이 파일의 장치다 — "무엇을 불렀나"가 아니라
 * "무엇을 부르고 무엇을 안 불렀나"의 쌍으로 봐야 갈래가 반대로 배선된 구현을 잡는다.
 *
 * ⚠️ 여기서 `AuthorizeResult` 는 **프로덕션 타입을 import** 한다. 손으로 복사한 사본을 쓰면
 * 유니온이 넓어져도 사본은 따라오지 않아 낡은 형태로 계속 green 일 수 있다(기존
 * useSocialLogin.test.tsx 가 그랬던 자리 — 이 사이클에서 함께 걷어냈다).
 *
 * 3동작: 준비(서버 응답·인가 결과 주입) → 실행(signIn/confirmAge) → 단언(phase·호출 인자).
 */

jest.mock('@/shared/api', () => ({
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
const mockSaveTokens = saveTokens as jest.MockedFunction<typeof saveTokens>;

/** SDK 어댑터가 돌려주는 토큰 갈래 인가 결과. */
function authorizeToken(accessToken: string) {
  return jest.fn(async (): Promise<AuthorizeResult> => ({
    type: 'success-token',
    accessToken,
  }));
}

/** 기존 브라우저 OAuth 어댑터가 돌려주는 code 갈래 인가 결과(google). */
const authorizeCode = jest.fn(async (): Promise<AuthorizeResult> => ({
  type: 'success-code',
  authorizationCode: 'google-auth-code',
  codeVerifier: 'google-verifier',
  redirectUri: 'trippilot://oauth/google',
}));

function tokenPair(isNewUser: boolean) {
  return {
    accessToken: 'server-access-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshToken: 'server-refresh-token',
    refreshExpiresIn: 7776000,
    isNewUser,
    account: {
      accountId: '00000000-0000-0000-0000-000000000001',
      status: 'ACTIVE',
      email: null,
      socialProviders: ['KAKAO'],
      onboardingCompleted: false,
    },
  };
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

function renderSocialLogin() {
  return renderHook(() => useSocialLogin(), { wrapper: createWrapper() });
}

beforeEach(() => {
  mockPostSocialLogin.mockReset();
  mockPostSocialTokenLogin.mockReset();
  mockSaveTokens.mockReset().mockResolvedValue(undefined);
  authorizeCode.mockClear();
});

describe('AC-1(훅) · 카카오 토큰 갈래는 /token 호출자로만 나간다', () => {
  it('accessToken 만 실어 postSocialTokenLogin("kakao") 을 부르고, 성공하면 저장 후 success 가 된다', async () => {
    // 준비 — 기존 사용자(isNewUser:false)라 연령확인 없이 바로 저장까지 간다.
    mockPostSocialTokenLogin.mockResolvedValue(tokenPair(false));
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('kakao', authorizeToken('kakao-access-token'));
    });

    // 단언
    await waitFor(() => expect(result.current.phase).toBe('success'));
    // 인자 **완전 일치** — deviceId 등 여분 필드가 붙으면 실패한다(D7: deviceId 미전송).
    expect(mockPostSocialTokenLogin).toHaveBeenCalledWith('kakao', {
      accessToken: 'kakao-access-token',
    });
    expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(1);
    // 대조 — code 경로로 새지 않았다. 이 쌍이 있어야 갈래 분기가 실제로 갈렸음이 증명된다.
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
    expect(mockSaveTokens).toHaveBeenCalledTimes(1);
  });
});

describe('AC-2(훅) · 네이버 토큰 갈래도 동형이다', () => {
  it('accessToken 만 실어 postSocialTokenLogin("naver") 을 부르고 success 가 된다', async () => {
    // 준비
    mockPostSocialTokenLogin.mockResolvedValue(tokenPair(false));
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('naver', authorizeToken('naver-access-token'));
    });

    // 단언
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(mockPostSocialTokenLogin).toHaveBeenCalledWith('naver', {
      accessToken: 'naver-access-token',
    });
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
    expect(mockSaveTokens).toHaveBeenCalledTimes(1);
  });
});

describe('AC-3 · 신규 가입 연령확인은 같은 accessToken 을 /token 으로 재전송한다', () => {
  it('신규면 토큰을 커밋하지 않고 needs-age 로 멈추고, 확인하면 ageConfirmation 을 붙여 /token 으로 다시 보낸 뒤 저장한다', async () => {
    // 준비 — 서버가 신규로 판정한다.
    mockPostSocialTokenLogin.mockResolvedValue(tokenPair(true));
    const { result } = renderSocialLogin();

    // 실행 1 — 첫 로그인.
    act(() => {
      result.current.signIn('kakao', authorizeToken('kakao-access-token'));
    });

    // 단언 1 — 멈춰 서고, 아직 아무것도 저장하지 않는다(BR-U0-05: 미확인 상태로 계정 확정 금지).
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));
    expect(result.current.isNewUser).toBe(true);
    expect(mockSaveTokens).not.toHaveBeenCalled();

    // 실행 2 — 사용자가 만 14세 확인.
    act(() => {
      result.current.confirmAge();
    });

    // 단언 2 — 재전송이 **같은 accessToken** 으로, **같은 /token 엔드포인트** 로 나간다.
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(2);
    expect(mockPostSocialTokenLogin.mock.calls[1]).toEqual([
      'kakao',
      {
        accessToken: 'kakao-access-token',
        ageConfirmation: { method: 'SELF_DECLARED' },
      },
    ]);
    // 핵심 — 재전송이 code 경로로 새지 않았다. 여기가 갈리면 실서버가 400 을 낸다.
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
    expect(mockSaveTokens).toHaveBeenCalledTimes(1);
  });
});

describe('AC-4 · google 은 기존 code 교환 경로에 남는다 (D3)', () => {
  it('code 갈래는 postSocialLogin 으로 가고 /token 호출자는 건드리지 않는다', async () => {
    // 준비 — 이 칸은 카카오·네이버만 옮긴다. google 이 딸려 오면 실서버가 거부한다.
    mockPostSocialLogin.mockResolvedValue(tokenPair(false));
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('google', authorizeCode);
    });

    // 단언
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
    expect(mockPostSocialLogin.mock.calls[0][0]).toBe('google');
    // 본체 — /token 으로 새지 않았다.
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
  });
});

describe('AC-5(훅) · 취소는 실패가 아니고 서버로 나가지도 않는다', () => {
  it('어댑터가 cancel 을 주면 phase=cancelled · errorCode=null 이고 두 엔드포인트 모두 호출되지 않는다', async () => {
    // 준비 — 카카오 reject 도 네이버 isCancel 도 어댑터에서 이 한 형태로 합쳐진다(T1-3·T1-4).
    // 여기서는 그 합쳐진 결과를 훅이 어떻게 다루는지만 본다.
    const authorizeCancel = jest.fn(async (): Promise<AuthorizeResult> => ({
      type: 'cancel',
    }));
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('kakao', authorizeCancel);
    });

    // 단언 — errorCode 가 채워지면 화면에 실패 배너가 뜬다(INV-4 의 반대 방향 위반).
    await waitFor(() => expect(result.current.phase).toBe('cancelled'));
    expect(result.current.errorCode).toBeNull();
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
  });
});
