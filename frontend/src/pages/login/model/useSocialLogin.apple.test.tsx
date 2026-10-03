import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { postSocialLogin, postSocialTokenLogin } from '@/shared/api';
import { saveTokens } from '@/shared/storage';
import { useSocialLogin, type AuthorizeResult } from './useSocialLogin';

/**
 * TRIP-932 AC-6~AC-8 — 애플 token 갈래의 서버 바디.
 *
 * 무엇을 보장하나: 인가 결과(success-token)에 authorizationCode 가 **있으면** 훅이
 *  (1) `/token` 바디에 accessToken 과 함께 싣고(AC-6),
 *  (2) 연령확인 재전송에도 그대로 다시 싣는다(AC-8 — 첫 요청이 400 이면 서버가 code 를 아직
 *      교환하지 않았으므로 다시 보내는 게 맞다).
 * 그리고 **없으면**(카카오·네이버) 바디에 `authorizationCode` 키 자체를 만들지 않는다(AC-7).
 *
 * ⚠️ 바디 단언은 `mock.calls[n]` + `toStrictEqual` 로 한다. `toHaveBeenCalledWith`·`toEqual` 은
 * `{ authorizationCode: undefined }` 와 "키 없음"을 같다고 본다(02a ★6 실측) — AC-7 을 못 잡는다.
 *
 * 훅은 provider 가 애플인지 몰라야 한다 — "결과에 code 가 있으면 싣는다"만 안다. 그래서 인가
 * 결과는 테스트가 스텁으로 주입한다(어댑터 변환은 makeAuthorize.apple.test.ts 가 본다).
 *
 * 3동작: 준비(서버 응답·인가 결과 주입) → 실행(signIn/confirmAge) → 단언(호출 인자).
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

/** 인가 결과를 그대로 돌려주는 스텁 authorize. */
function authorizeWith(result: AuthorizeResult) {
  return jest.fn(async (): Promise<AuthorizeResult> => result);
}

const APPLE_RESULT: AuthorizeResult = {
  type: 'success-token',
  accessToken: 'id-tok',
  authorizationCode: 'auth-code',
};

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
      socialProviders: ['APPLE'],
      onboardingCompleted: false,
    },
  };
}

/** 서버가 "연령확인이 아직 없다"며 거절할 때 훅에 닿는 정규화 에러(status 는 일부러 뺀다). */
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

function renderSocialLogin() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return renderHook(() => useSocialLogin(), { wrapper: Wrapper });
}

beforeEach(() => {
  mockPostSocialLogin.mockReset();
  mockPostSocialTokenLogin.mockReset();
  mockSaveTokens.mockReset().mockResolvedValue(undefined);
});

describe('AC-6 · 애플 token 갈래는 accessToken 과 authorizationCode 를 함께 보낸다', () => {
  it('postSocialTokenLogin("apple", { accessToken, authorizationCode }) 를 완전 일치로 부르고 code 경로는 안 부른다', async () => {
    // 준비
    mockPostSocialTokenLogin.mockResolvedValue(tokenPair(false));
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('apple', authorizeWith(APPLE_RESULT));
    });

    // 단언
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(1);
    expect(mockPostSocialTokenLogin.mock.calls[0]).toStrictEqual([
      'apple',
      { accessToken: 'id-tok', authorizationCode: 'auth-code' },
    ]);
    // 대조 — code 경로(브라우저 OAuth 교환)로 새지 않았다.
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
  });
});

describe('AC-7 · 카카오·네이버 바디에는 authorizationCode 키 자체가 없다', () => {
  it.each(['kakao', 'naver'] as const)(
    '%s 는 { accessToken } 만 보낸다 — authorizationCode: undefined 도 허용하지 않는다',
    async (provider) => {
      // 준비 — code 가 없는 SDK 결과.
      mockPostSocialTokenLogin.mockResolvedValue(tokenPair(false));
      const { result } = renderSocialLogin();

      // 실행
      act(() => {
        result.current.signIn(
          provider,
          authorizeWith({ type: 'success-token', accessToken: 'sdk-token' })
        );
      });

      // 단언 — toStrictEqual 은 undefined 키를 "다르다"고 본다(★6).
      await waitFor(() => expect(result.current.phase).toBe('success'));
      expect(mockPostSocialTokenLogin.mock.calls[0]).toStrictEqual([
        provider,
        { accessToken: 'sdk-token' },
      ]);
      expect(mockPostSocialTokenLogin.mock.calls[0][1]).not.toHaveProperty(
        'authorizationCode'
      );
    }
  );
});

describe('AC-8 · 연령확인 재전송에도 authorizationCode 가 다시 실린다', () => {
  it('첫 요청이 연령확인 누락 400 이면 needs-age 로 가고, confirmAge 재전송은 code 까지 포함한 바디다', async () => {
    // 준비 — 첫 호출만 400, 두 번째부터 가입 성공.
    mockPostSocialTokenLogin
      .mockRejectedValueOnce(ageConfirmationRequired())
      .mockResolvedValue(tokenPair(true));
    const { result } = renderSocialLogin();

    // 실행 1 — 로그인 → 연령확인 단계.
    act(() => {
      result.current.signIn('apple', authorizeWith(APPLE_RESULT));
    });
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));

    // 실행 2 — 만 14세 확인.
    act(() => {
      result.current.confirmAge();
    });

    // 단언 — 두 번째 호출 인자 완전 일치.
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(2);
    expect(mockPostSocialTokenLogin.mock.calls[1]).toStrictEqual([
      'apple',
      {
        accessToken: 'id-tok',
        authorizationCode: 'auth-code',
        ageConfirmation: { method: 'SELF_DECLARED' },
      },
    ]);
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
  });
});
