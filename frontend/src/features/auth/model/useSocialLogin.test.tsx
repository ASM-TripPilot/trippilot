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

// 시스템 실패(reject) 전용 목 — 취소(resolve) 목과 절대 겸용하지 않는다(7-21). 겸용하면
// "취소를 실패로 처리하는 버그"가 테스트를 그대로 통과시킬 수 있다.
const authorizeReject = jest.fn(async (): Promise<AuthorizeResult> => {
  throw new Error('실 OAuth client 미설정');
});

/**
 * "인가 중"/"교환 중" 구간을 붙잡아 두는 deferred 헬퍼(7-12).
 * 반환된 release() 를 호출하기 전까지 authorize 는 끝나지 않는다 — 중간 상태(잠금 대상)를
 * 관측 가능하게 만드는 유일한 방법이다.
 */
function createDeferredAuthorize(result: AuthorizeResult) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const authorize = jest.fn(async (): Promise<AuthorizeResult> => {
    await gate;
    return result;
  });
  return { authorize, release: () => release() };
}

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
  authorizeReject.mockClear();
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

// ── 결함 E · AC-S5 (신규 케이스 9~14) ────────────────────────────────────
// 위 "취소" describe(케이스 168~197 원본)는 오케스트레이터 지시(J1 기존 3건 불변)에 따라
// 손대지 않는다. errorCode 분리 검증(케이스 10·11 이 요구하는 신규 단언)은 그 원본을 고치는
// 대신 아래에 새 it 으로 추가해, "취소(resolve)와 실패(reject)가 서로 다른 결과를 남긴다"는
// 계약을 원본 테스트를 훼손하지 않고 덮는다.

describe('useSocialLogin — 인가 실패(reject)는 화면을 authorizing 에 가두지 않는다 (결함 E · INV-4 · 케이스 9)', () => {
  it("authorize() 가 reject 하면 'authorizing' 에 영구 고정되지 않고 'error' 로 전이한다", async () => {
    // 준비 — 시스템 실패를 흉내내는 reject 목. postSocialLogin 은 아무것도 설정하지 않는다
    // (인가가 실패했으면 서버로 나가면 안 되므로 — 불리면 어떤 값을 리턴할지 정할 이유가 없다).
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('apple', authorizeReject);
    });

    // 단언 — 지금은 authorize() 가 try/catch 밖에서 호출돼 phase 가 'authorizing' 에 영원히
    // 고정된다. waitFor 는 기본 1초 뒤 타임아웃으로 실패한다(이것도 정상적인 red 다 · 7-15).
    await waitFor(() => expect(result.current.phase).toBe('error'));
    // errorCode 는 "비어 있지 않다"만 본다 — 화면은 어떤 코드든 배너로 덮으므로(케이스 29)
    // 특정 문자열을 못박으면 의미 없는 결합만 늘어난다.
    expect(result.current.errorCode).toEqual(expect.any(String));
    expect(result.current.errorCode).not.toBe('');
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});

describe('useSocialLogin — 취소·실패 분리 (AC-S5 · 결함 E 대조 · 케이스 10·11 강화)', () => {
  it('cancel 은 errorCode 를 채우지 않는다 — 실패가 아니다', async () => {
    // 준비 — 취소(resolve) 전용 목. reject 목과 겸용하지 않는다(7-21).
    const authorizeCancel = jest.fn(async (): Promise<AuthorizeResult> => ({
      type: 'cancel',
    }));
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('google', authorizeCancel);
    });

    // 단언 — phase 는 cancelled(기존 계약), errorCode 는 null(신규 단언) 이어야 한다.
    // errorCode 가 채워지면 화면에 실패 배너가 뜨는 잘못된 구현을 이 단언이 잡는다.
    await waitFor(() => expect(result.current.phase).toBe('cancelled'));
    expect(result.current.errorCode).toBeNull();
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
  });

  it('dismiss 도 errorCode 를 채우지 않는다 — 실패가 아니다', async () => {
    // 준비
    const authorizeDismiss = jest.fn(async (): Promise<AuthorizeResult> => ({
      type: 'dismiss',
    }));
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('naver', authorizeDismiss);
    });

    // 단언
    await waitFor(() => expect(result.current.phase).toBe('cancelled'));
    expect(result.current.errorCode).toBeNull();
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
  });
});

describe('useSocialLogin — 연속 탭 잠금 (AC-S5 · Seed §5 동시성안전 · 케이스 12·13)', () => {
  it("인가 중('authorizing') 두 번째 탭은 무시된다 — provider 가 섞이지 않는다", async () => {
    // 준비 — 첫 인가(google)는 바깥에서 풀어줄 때까지 끝나지 않는다. 두 번째(kakao)는
    // 즉시 success 지만 "잠금 대상"이라 호출조차 되면 안 된다.
    const { authorize: authorizeBlocked, release } = createDeferredAuthorize({
      type: 'success',
      authorizationCode: 'auth-code-blocked',
      codeVerifier: 'verifier-blocked',
      redirectUri: 'trippilot://oauth/google',
    });
    const authorizeSecond = jest.fn(async (): Promise<AuthorizeResult> => ({
      type: 'success',
      authorizationCode: 'auth-code-second',
      codeVerifier: 'verifier-second',
      redirectUri: 'trippilot://oauth/kakao',
    }));
    mockPostSocialLogin.mockResolvedValue(tokenPair(false));

    const { result } = renderSocialLogin();

    // 실행 — 첫 탭(google), 아직 안 끝난 채로 두 번째 탭(kakao).
    act(() => {
      result.current.signIn('google', authorizeBlocked);
    });
    act(() => {
      result.current.signIn('kakao', authorizeSecond);
    });
    // 첫 인가를 이제 풀어준다.
    release();
    await waitFor(() => expect(result.current.phase).toBe('success'));

    // 단언 — "무시됐다"를 3중으로 관측한다(7-20).
    // ① 두 번째 authorize 함수가 아예 호출되지 않았다(가장 강한 증거).
    expect(authorizeSecond).not.toHaveBeenCalled();
    // ② 서버 호출은 1회뿐이다(인가코드 1회 교환).
    expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
    // ③ 첫 provider(google)로만 교환됐다 — provider 가 뒤바뀌지 않았다.
    expect(mockPostSocialLogin.mock.calls[0][0]).toBe('google');
  });

  it("교환 중('exchanging') 두 번째 탭도 무시된다 — 인가코드 1회 교환", async () => {
    // 준비 — 인가(google)는 즉시 끝나지만, 서버 교환(postSocialLogin)이 바깥에서 풀어줄 때까지
    // 멈춰 있다. 그 사이가 신규 phase 'exchanging' 이다.
    let releaseExchange: () => void = () => {};
    const exchangeGate = new Promise<void>((resolve) => {
      releaseExchange = resolve;
    });
    mockPostSocialLogin.mockImplementation(async () => {
      await exchangeGate;
      return tokenPair(false);
    });
    const authorizeSecond = jest.fn(async (): Promise<AuthorizeResult> => ({
      type: 'success',
      authorizationCode: 'auth-code-second',
      codeVerifier: 'verifier-second',
      redirectUri: 'trippilot://oauth/naver',
    }));

    const { result } = renderSocialLogin();

    // 실행 1 — 첫 인가·교환 시작. 'exchanging' 진입을 직접 관측한다(신규 phase 존재 확인).
    act(() => {
      result.current.signIn('google', authorizeSuccess);
    });
    await waitFor(() => expect(result.current.phase).toBe('exchanging'));

    // 실행 2 — 교환이 끝나기 전에 두 번째 탭(naver).
    act(() => {
      result.current.signIn('naver', authorizeSecond);
    });
    // 서버 응답을 풀어준다.
    releaseExchange();
    await waitFor(() => expect(result.current.phase).toBe('success'));

    // 단언
    expect(authorizeSecond).not.toHaveBeenCalled();
    // 같은 인가코드가 두 번 나가지 않았다(1회 교환).
    expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
  });
});

describe('useSocialLogin — 잠금은 영구가 아니다 (UX-04 재시도 즉시 가능 · 케이스 14)', () => {
  it('한 번 실패해도 다음 시도는 잠기지 않고 성공까지 간다', async () => {
    // 준비 — 1차 시도는 실패(reject), 2차 시도는 성공.
    const { result } = renderSocialLogin();

    // 실행 1 — 실패로 끝난다.
    act(() => {
      result.current.signIn('apple', authorizeReject);
    });
    await waitFor(() => expect(result.current.phase).toBe('error'));

    // 실행 2 — 같은 훅 인스턴스로 다시 시도한다(재시도 즉시 가능해야 UX-04 충족).
    mockPostSocialLogin.mockResolvedValue(tokenPair(false));
    act(() => {
      result.current.signIn('google', authorizeSuccess);
    });

    // 단언 — 두 번째 시도는 잠기지 않고 성공까지 가며, 이전 에러가 지워진다.
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(authorizeSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.errorCode).toBeNull();
  });
});
