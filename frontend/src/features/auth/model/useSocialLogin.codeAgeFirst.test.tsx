import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { postSocialLogin, postSocialTokenLogin } from '@/shared/api';
import { saveTokens } from '@/shared/storage';
import { useSocialLogin, type AuthorizeResult } from './useSocialLogin';

/**
 * TRIP-1035 — code 갈래(브라우저 OAuth)는 인가 **전에** 연령을 묻는다.
 *
 * 왜 필요한가: 인가코드는 1회용이다. 서버는 코드 교환·프로필 조회를 연령 검사보다 먼저 하므로,
 * 400(연령확인 누락)을 받았을 때 그 코드는 이미 쓰였다 — token 갈래처럼 "400 → 시트 → 재전송"이
 * 안 된다. 그래서 code 갈래는 authorize() 를 부르기 전에 시트를 띄우고, 확인하면 **첫** 교환
 * 요청에 ageConfirmation 을 싣는다.
 *
 * 갈래를 아는 수단: `makeAuthorize(provider)` 가 돌려주는 함수의 `flow` 속성('code'|'token').
 * 없으면 token 으로 취급한다(사전 시트 없음 · 선언 미탑재). 여기서는 `withFlow()` 로 그 표지를
 * 직접 붙인 authorize 를 주입한다.
 *
 * 두 엔드포인트를 나란히 목으로 세운다 — "무엇을 불렀나"와 "무엇을 안 불렀나"를 쌍으로 봐야
 * 갈래가 반대로 배선된 구현을 잡는다(tokenPath.test.tsx 의 장치 계승).
 *
 * 3동작: 준비(flow 표지 + 서버 응답) → 실행(signIn / confirmAge) → 단언(phase · 호출 인자·횟수).
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

const GOOGLE_CODE: AuthorizeResult = {
  type: 'success-code',
  authorizationCode: 'google-auth-code',
  codeVerifier: 'google-verifier',
  redirectUri: 'trippilot://oauth/google',
};

const KAKAO_TOKEN: AuthorizeResult = {
  type: 'success-token',
  accessToken: 'kakao-access-token',
};

const SELF_DECLARED = { method: 'SELF_DECLARED' };

/** 갈래 표지(flow)를 붙인 authorize 목. 함수에 속성을 덧붙여 `makeAuthorize` 의 반환 모양을 흉내낸다. */
function withFlow(flow: 'code' | 'token', result: AuthorizeResult) {
  return Object.assign(
    jest.fn(async (): Promise<AuthorizeResult> => result),
    { flow }
  );
}

/** release() 전까지 끝나지 않는 authorize — "인가 중" 구간을 붙잡아 두는 장치. */
function withFlowDeferred(flow: 'code' | 'token', result: AuthorizeResult) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const authorize = Object.assign(
    jest.fn(async (): Promise<AuthorizeResult> => {
      await gate;
      return result;
    }),
    { flow }
  );
  return { authorize, release: () => release() };
}

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
      socialProviders: ['GOOGLE'],
      onboardingCompleted: false,
    },
  };
}

/** 서버의 "연령확인이 아직 없다" 거절(정규화 후). status 는 일부러 뺀다(TRIP-248 D2). */
function ageConfirmationRequired() {
  return {
    code: 'VALIDATION_ERROR',
    fields: [
      {
        field: 'ageConfirmation',
        reason: '신규 가입 시 연령확인이 필요합니다',
      },
    ],
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
  // 교환은 성공을 기본으로 깐다 — 시트 없이 바로 교환하는 구현이 'success' 로 끝나야 red 메시지가
  // "needs-age 기대 / success 수신"으로 원인을 가리킨다(비워 두면 TypeError → error 로 흐려진다).
  mockPostSocialLogin.mockReset().mockResolvedValue(tokenPair(false));
  mockPostSocialTokenLogin.mockReset().mockResolvedValue(tokenPair(false));
  mockSaveTokens.mockReset().mockResolvedValue(undefined);
});

describe('TRIP-1035 AC-1 · code 갈래는 인가 전에 멈춘다', () => {
  it('flow=code 면 authorize 를 부르지 않고 needs-age(연령 시트)로 멈추며, 서버로 아무것도 나가지 않는다', async () => {
    // 준비
    const authorize = withFlow('code', GOOGLE_CODE);
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('google', authorize);
    });

    // 단언 — 화면은 phase==='needs-age' 일 때만 연령 시트를 그린다(SocialLoginScreen 계약).
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));
    expect(authorize).not.toHaveBeenCalled();
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});

describe('TRIP-1035 AC-2 · 확인하면 첫 요청에 선언이 실린다', () => {
  it('confirmAge → authorize 1회 → postSocialLogin 1회, 그 body 에 ageConfirmation=SELF_DECLARED 가 실려 가입까지 간다', async () => {
    // 준비 — 신규 가입자. 첫 요청에 선언이 실려 있으므로 서버는 바로 계정을 만든다.
    mockPostSocialLogin.mockResolvedValue(tokenPair(true));
    const authorize = withFlow('code', GOOGLE_CODE);
    const { result } = renderSocialLogin();
    act(() => {
      result.current.signIn('google', authorize);
    });
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));

    // 실행
    act(() => {
      result.current.confirmAge();
    });

    // 단언 — 호출 목록 전체를 완전 일치로 본다: 횟수 1회 + 여분 필드 없음을 한 번에.
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(mockPostSocialLogin.mock.calls).toEqual([
      [
        'google',
        {
          authorizationCode: 'google-auth-code',
          codeVerifier: 'google-verifier',
          redirectUri: 'trippilot://oauth/google',
          ageConfirmation: SELF_DECLARED,
        },
      ],
    ]);
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
    expect(result.current.isNewUser).toBe(true);
    expect(mockSaveTokens).toHaveBeenCalledTimes(1);
  });

  it('결정 A — 방금 한 선언을 다음 로그인에 재사용하지 않는다: 다시 누르면 다시 묻는다', async () => {
    // 준비 — 한 번 확인해 로그인까지 끝낸 상태.
    const first = withFlow('code', GOOGLE_CODE);
    const { result } = renderSocialLogin();
    act(() => {
      result.current.signIn('google', first);
    });
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));
    act(() => {
      result.current.confirmAge();
    });
    await waitFor(() => expect(result.current.phase).toBe('success'));

    // 실행 — 같은 훅으로 새 로그인 시도.
    const second = withFlow('code', GOOGLE_CODE);
    act(() => {
      result.current.signIn('google', second);
    });

    // 단언 — 다시 시트에서 멈추고, 두 번째 인가·교환은 아직 없다.
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));
    expect(second).not.toHaveBeenCalled();
    expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
  });
});

describe('TRIP-1035 AC-7 · 선언을 싣고도 400 이면 시트를 반복하지 않는다', () => {
  it('확인을 실은 code 요청이 또 400(ageConfirmation)을 받으면 needs-age 가 아니라 error 다 — 재인가도 없다', async () => {
    // 준비 — 서버가 선언이 있어도 거절하는(비정상) 상황.
    mockPostSocialLogin.mockRejectedValue(ageConfirmationRequired());
    const authorize = withFlow('code', GOOGLE_CODE);
    const { result } = renderSocialLogin();
    act(() => {
      result.current.signIn('google', authorize);
    });
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));

    // 실행
    act(() => {
      result.current.confirmAge();
    });

    // 단언 — 시트로 되돌아가면 사용자는 확인을 눌러도 끝나지 않는 고리에 갇힌다(INV-4).
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.errorCode).toBe('VALIDATION_ERROR');
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});

describe('TRIP-1035 AC-12 · 확인 뒤 브라우저에서 취소하면 cancelled 다', () => {
  it.each(['cancel', 'dismiss'] as const)(
    'authorize 가 %s 를 주면 phase=cancelled · errorCode=null 이고 서버 요청은 0회다',
    async (type) => {
      // 준비
      const authorize = withFlow('code', { type });
      const { result } = renderSocialLogin();
      act(() => {
        result.current.signIn('google', authorize);
      });
      await waitFor(() => expect(result.current.phase).toBe('needs-age'));

      // 실행
      act(() => {
        result.current.confirmAge();
      });

      // 단언
      await waitFor(() => expect(result.current.phase).toBe('cancelled'));
      expect(result.current.errorCode).toBeNull();
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(mockPostSocialLogin).not.toHaveBeenCalled();
      expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
    }
  );
});

describe('TRIP-1035 AC-10 · 확인 버튼 연타', () => {
  it('리렌더 전에 confirmAge 가 두 번 들어와도 authorize 는 1회다 — 브라우저 로그인 창이 두 번 뜨지 않는다', async () => {
    // 준비 — 인가가 끝나지 않게 붙잡아 두어, 두 번째 확인이 "인가 중"에 떨어지게 한다.
    const { authorize, release } = withFlowDeferred('code', GOOGLE_CODE);
    const { result } = renderSocialLogin();
    act(() => {
      result.current.signIn('google', authorize);
    });
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));

    // 실행 — 한 act 안에서 두 번: 같은 렌더의 confirmAge 를 두 번 부르는 것이 실제 연타다.
    act(() => {
      result.current.confirmAge();
      result.current.confirmAge();
    });
    release();

    // 단언
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
  });
});

describe('TRIP-1035 AC-9 · 인가 중 연타 잠금은 새 경로에서도 유지된다', () => {
  it('확인 뒤 인가가 끝나기 전의 두 번째 signIn 은 무시된다 — provider 가 섞이지 않는다', async () => {
    // 준비
    const { authorize: google, release } = withFlowDeferred(
      'code',
      GOOGLE_CODE
    );
    const kakao = withFlow('token', KAKAO_TOKEN);
    const { result } = renderSocialLogin();
    act(() => {
      result.current.signIn('google', google);
    });
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));

    // 실행 — 확인(인가 시작, 아직 안 끝남) → 그 사이 카카오 탭 → 인가 풀기.
    act(() => {
      result.current.confirmAge();
    });
    act(() => {
      result.current.signIn('kakao', kakao);
    });
    release();

    // 단언
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(kakao).not.toHaveBeenCalled();
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
    expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
    expect(mockPostSocialLogin.mock.calls[0][0]).toBe('google');
  });
});

describe('TRIP-1035 AC-11 · 이전 시도가 남긴 교환 요청을 재사용하지 않는다 (양방향)', () => {
  it('(a) 카카오 400 시트를 확인 없이 두고 구글로 가면, 확인은 구글 인가로 이어지고 카카오는 재전송되지 않는다', async () => {
    // 준비 — 카카오 첫 요청이 400 으로 멈춘다(시트 → 사용자는 취소: 확인을 누르지 않는다).
    mockPostSocialTokenLogin.mockRejectedValueOnce(ageConfirmationRequired());
    const kakao = withFlow('token', KAKAO_TOKEN);
    const google = withFlow('code', GOOGLE_CODE);
    const { result } = renderSocialLogin();
    act(() => {
      result.current.signIn('kakao', kakao);
    });
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));
    expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(1);

    // 실행 — 구글 버튼 → 사전 시트 확인.
    act(() => {
      result.current.signIn('google', google);
    });
    act(() => {
      result.current.confirmAge();
    });

    // 단언 — 확인은 "지금 떠 있는 시트"(구글)의 것이다.
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(google).toHaveBeenCalledTimes(1);
    expect(mockPostSocialLogin.mock.calls).toEqual([
      [
        'google',
        {
          authorizationCode: 'google-auth-code',
          codeVerifier: 'google-verifier',
          redirectUri: 'trippilot://oauth/google',
          ageConfirmation: SELF_DECLARED,
        },
      ],
    ]);
    // 카카오 accessToken 재전송이 끼어들지 않았다 — 첫 요청 1회 그대로.
    expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(1);
  });

  it('(b) 구글 사전 시트를 확인 없이 두고 카카오로 가면, 카카오 400 시트의 확인은 카카오 재전송이고 구글 인가는 없다', async () => {
    // 준비 — 구글 사전 시트에서 멈춘 채(취소는 화면만 idle 로 보이고 훅은 needs-age 에 남는다).
    const google = withFlow('code', GOOGLE_CODE);
    const kakao = withFlow('token', KAKAO_TOKEN);
    mockPostSocialTokenLogin
      .mockRejectedValueOnce(ageConfirmationRequired())
      .mockResolvedValue(tokenPair(true));
    const { result } = renderSocialLogin();
    act(() => {
      result.current.signIn('google', google);
    });
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));

    // 실행 — 그 상태에서 카카오 탭(잠기면 안 된다) → 400 → 시트 → 확인.
    act(() => {
      result.current.signIn('kakao', kakao);
    });
    await waitFor(() =>
      expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(1)
    );
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));
    act(() => {
      result.current.confirmAge();
    });

    // 단언
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(google).not.toHaveBeenCalled();
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
    expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(2);
    expect(mockPostSocialTokenLogin.mock.calls[1]).toEqual([
      'kakao',
      { accessToken: 'kakao-access-token', ageConfirmation: SELF_DECLARED },
    ]);
  });
});

describe('TRIP-1035 AC-6 · 사용자가 확인하지 않은 경로에는 선언이 실리지 않는다', () => {
  it('판정은 token 인데 결과가 code 로 온 경우 — 묻지 않고 인가하며, body 에 ageConfirmation 키 자체가 없다', async () => {
    // 준비 — 판정과 실제 결과가 어긋난 경우(env 드리프트 등).
    const authorize = withFlow('token', {
      type: 'success-code',
      authorizationCode: 'naver-auth-code',
      codeVerifier: 'naver-verifier',
      redirectUri: 'trippilot://oauth/naver',
    });
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('naver', authorize);
    });

    // 단언 — 키 **부재**를 본다. toBeUndefined() 는 { ageConfirmation: undefined } 를 통과시킨다.
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
    const [, body] = mockPostSocialLogin.mock.calls[0];
    expect(Object.keys(body)).not.toContain('ageConfirmation');
  });
});

describe('TRIP-1035 AC-8 · token 갈래는 현행 그대로다 (무회귀)', () => {
  it('flow=token 이면 사전 시트 없이 바로 인가하고, 400 → needs-age → 확인은 같은 accessToken 재전송이다(재인가 없음)', async () => {
    // 준비
    mockPostSocialTokenLogin
      .mockRejectedValueOnce(ageConfirmationRequired())
      .mockResolvedValue(tokenPair(true));
    const authorize = withFlow('token', KAKAO_TOKEN);
    const { result } = renderSocialLogin();

    // 실행 1 — 버튼. 확인을 누르지 않았는데도 인가가 먼저 불린다.
    act(() => {
      result.current.signIn('kakao', authorize);
    });
    await waitFor(() =>
      expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(1)
    );
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(mockPostSocialTokenLogin.mock.calls[0][1])
    ).not.toContain('ageConfirmation');
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));

    // 실행 2 — 서버 400 뒤의 시트에서 확인.
    act(() => {
      result.current.confirmAge();
    });

    // 단언
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(mockPostSocialTokenLogin.mock.calls[1]).toEqual([
      'kakao',
      { accessToken: 'kakao-access-token', ageConfirmation: SELF_DECLARED },
    ]);
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
  });
});
