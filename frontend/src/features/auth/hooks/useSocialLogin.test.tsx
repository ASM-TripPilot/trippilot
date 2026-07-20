import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { postSocialLogin } from '@/shared/api';
import { saveTokens } from '@/shared/storage';
import { useSocialLogin } from './useSocialLogin';

jest.mock('@/shared/api', () => ({ postSocialLogin: jest.fn() }));
jest.mock('@/shared/storage', () => ({ saveTokens: jest.fn() }));

const mockPostSocialLogin = postSocialLogin as jest.MockedFunction<
  typeof postSocialLogin
>;
const mockSaveTokens = saveTokens as jest.MockedFunction<typeof saveTokens>;

type AuthorizeResult =
  | {
      type: 'success';
      authorizationCode: string;
      codeVerifier: string;
      redirectUri: string;
    }
  | { type: 'cancel' }
  | { type: 'dismiss' };

const authorizeSuccess = jest.fn(async (): Promise<AuthorizeResult> => ({
  type: 'success',
  authorizationCode: 'auth-code-123',
  codeVerifier: 'verifier-xyz',
  redirectUri: 'trippilot://oauth/google',
}));

function tokenPair(isNewUser: boolean) {
  return {
    accessToken: 'access-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshToken: 'refresh-token',
    refreshExpiresIn: 7776000,
    isNewUser,
    account: {
      accountId: '00000000-0000-0000-0000-000000000001',
      status: 'ACTIVE',
      email: null,
      socialProviders: ['GOOGLE'],
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
  mockSaveTokens.mockReset().mockResolvedValue(undefined);
  authorizeSuccess.mockClear();
});

describe('useSocialLogin — 신규 가입 PKCE 교환 (AC-ONB-01-1·3)', () => {
  it('provider 동의 code 를 PKCE 바디로 서버에 교환하고, 신규면 ACTIVE 계정 생성(isNewUser=true) 후 연령확인 단계로 간다', async () => {
    mockPostSocialLogin.mockResolvedValue(tokenPair(true));
    const { result } = renderSocialLogin();

    act(() => {
      result.current.signIn('google', authorizeSuccess);
    });

    await waitFor(() => expect(result.current.phase).toBe('needs-age'));

    expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
    const [provider, body] = mockPostSocialLogin.mock.calls[0];
    expect(provider).toBe('google');
    expect(body).toMatchObject({
      authorizationCode: 'auth-code-123',
      codeVerifier: 'verifier-xyz',
      redirectUri: 'trippilot://oauth/google',
    });
    expect(body.ageConfirmation).toBeUndefined();
    expect(result.current.isNewUser).toBe(true);
    // 신규 계정은 연령확인 재전송 전까지 토큰을 커밋하지 않는다.
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('교환 바디는 codeVerifier 만 담고 어떤 클라이언트 시크릿도 담지 않는다 (PKCE·시크릿 비노출, AC-ONB-01-3)', async () => {
    mockPostSocialLogin.mockResolvedValue(tokenPair(false));
    const { result } = renderSocialLogin();

    act(() => {
      result.current.signIn('google', authorizeSuccess);
    });

    await waitFor(() => expect(result.current.phase).toBe('success'));

    const [, body] = mockPostSocialLogin.mock.calls[0];
    expect(body.codeVerifier).toBe('verifier-xyz');
    const keys = Object.keys(body).map((k) => k.toLowerCase());
    expect(keys).not.toContain('clientsecret');
    expect(keys).not.toContain('client_secret');
    expect(keys).not.toContain('secret');
  });
});

describe('useSocialLogin — 연령확인 재전송 (AC-ONB-01-7)', () => {
  it('신규 판정 후 confirmAge 는 ageConfirmation{method:SELF_DECLARED} 로 재전송하고 성공 시 토큰을 저장한다', async () => {
    mockPostSocialLogin.mockResolvedValue(tokenPair(true));
    const { result } = renderSocialLogin();

    act(() => {
      result.current.signIn('google', authorizeSuccess);
    });
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));

    act(() => {
      result.current.confirmAge();
    });
    await waitFor(() => expect(result.current.phase).toBe('success'));

    expect(mockPostSocialLogin).toHaveBeenCalledTimes(2);
    const [, resendBody] = mockPostSocialLogin.mock.calls[1];
    expect(resendBody.ageConfirmation).toEqual({ method: 'SELF_DECLARED' });
    expect(mockSaveTokens).toHaveBeenCalledTimes(1);
  });

  it('연령 미달로 서버가 422 AgeNotMet 를 반환하면 계정 미생성·에러(AGE_NOT_MET)로 남는다', async () => {
    mockPostSocialLogin.mockRejectedValue({ code: 'AGE_NOT_MET', status: 422 });
    const { result } = renderSocialLogin();

    act(() => {
      result.current.signIn('google', authorizeSuccess);
    });

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.errorCode).toBe('AGE_NOT_MET');
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});

describe('useSocialLogin — 기존 로그인 (AC-ONB-01-2)', () => {
  it('기존 (provider,sub) 는 isNewUser=false 로 바로 로그인 성공하고 토큰을 저장한다', async () => {
    mockPostSocialLogin.mockResolvedValue(tokenPair(false));
    const { result } = renderSocialLogin();

    act(() => {
      result.current.signIn('kakao', authorizeSuccess);
    });

    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(result.current.isNewUser).toBe(false);
    expect(mockSaveTokens).toHaveBeenCalledTimes(1);
  });
});

describe('useSocialLogin — 취소 (AC-ONB-01-4)', () => {
  it('provider 동의 취소(cancel)면 서버 호출 없이 cancelled 로 복귀한다', async () => {
    const authorizeCancel = jest.fn(async (): Promise<AuthorizeResult> => ({
      type: 'cancel',
    }));
    const { result } = renderSocialLogin();

    act(() => {
      result.current.signIn('google', authorizeCancel);
    });

    await waitFor(() => expect(result.current.phase).toBe('cancelled'));
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('provider 창 dismiss 도 서버 호출 없이 cancelled 로 처리한다', async () => {
    const authorizeDismiss = jest.fn(async (): Promise<AuthorizeResult> => ({
      type: 'dismiss',
    }));
    const { result } = renderSocialLogin();

    act(() => {
      result.current.signIn('naver', authorizeDismiss);
    });

    await waitFor(() => expect(result.current.phase).toBe('cancelled'));
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
  });
});

describe('useSocialLogin — 서버 에러 코드 매핑 (AC-ONB-01-5·6)', () => {
  it('401 SocialAuthFailed → error(SOCIAL_AUTH_FAILED)', async () => {
    mockPostSocialLogin.mockRejectedValue({
      code: 'SOCIAL_AUTH_FAILED',
      status: 401,
    });
    const { result } = renderSocialLogin();

    act(() => {
      result.current.signIn('google', authorizeSuccess);
    });

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.errorCode).toBe('SOCIAL_AUTH_FAILED');
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('429 RateLimited → error(RATE_LIMITED)', async () => {
    mockPostSocialLogin.mockRejectedValue({
      code: 'RATE_LIMITED',
      status: 429,
    });
    const { result } = renderSocialLogin();

    act(() => {
      result.current.signIn('google', authorizeSuccess);
    });

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.errorCode).toBe('RATE_LIMITED');
  });

  it('409 SocialEmailConflict → error(SOCIAL_EMAIL_CONFLICT) + 기존 provider 노출', async () => {
    mockPostSocialLogin.mockRejectedValue({
      code: 'SOCIAL_EMAIL_CONFLICT',
      status: 409,
      existingProvider: 'kakao',
    });
    const { result } = renderSocialLogin();

    act(() => {
      result.current.signIn('google', authorizeSuccess);
    });

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.errorCode).toBe('SOCIAL_EMAIL_CONFLICT');
    expect(result.current.conflictProvider).toBe('kakao');
  });

  it('충돌 응답에 기존 provider 필드가 없으면 conflictProvider 는 null 로 폴백한다', async () => {
    mockPostSocialLogin.mockRejectedValue({
      code: 'SOCIAL_EMAIL_CONFLICT',
      status: 409,
    });
    const { result } = renderSocialLogin();

    act(() => {
      result.current.signIn('google', authorizeSuccess);
    });

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.conflictProvider).toBeNull();
  });
});
