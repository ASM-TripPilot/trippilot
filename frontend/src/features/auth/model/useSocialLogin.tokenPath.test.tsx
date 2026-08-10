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

/**
 * TRIP-248 — 백엔드가 "연령확인이 아직 없다"고 거절할 때 훅에 닿는 정규화 에러.
 *
 * ⚠️ `status` 를 일부러 담지 않는다(D2). 판정은 body 의 `code` + `fields` 만 보아야 하고,
 * 픽스처에 400 을 넣어 주면 `status === 400` 으로 짠 구현이 그대로 통과해 D2 가 아무 심판도
 * 못 받는다. 연령 관련 상태코드는 이미 정본(422)과 백엔드 구현(403)이 갈라진 전례가 있다.
 *
 * `field` 값은 백엔드 AuthenticateWithSocialUseCase.kt:77 원문 그대로다.
 */
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

/**
 * ── TRIP-248 (카카오 token 갈래 한정) ──────────────────────────────────────
 *
 * 아래 describe 들의 AC 번호는 **TRIP-248 의 것**이다. 이 파일 위쪽의 `AC-1(훅)`·`AC-3`·`AC-4`
 * 는 TRIP-210 의 번호라 숫자가 겹치지만 뜻이 다르다 — 그래서 접두사를 붙인다.
 *
 * 무엇이 바뀌었나: 이전 판은 "서버가 200 + isNewUser:true 를 주면 needs-age 로 멈춘다"를
 * 지켰다. 실서버는 그렇게 답하지 않는다 — 연령확인이 없는 첫 요청은 **400 으로 거절**된다
 * (AuthenticateWithSocialUseCase.kt:76-77). 그래서 신규 가입이 영구 차단돼 있었다(TRIP-248).
 */

describe('TRIP-248 AC-1 · 연령확인 누락 400 은 needs-age 로 간다 (token 갈래)', () => {
  it('400(VALIDATION_ERROR + fields[ageConfirmation])을 받으면 멈춰 서고 토큰을 저장하지 않는다', async () => {
    // 준비 — 서버가 "연령확인이 필요하다"며 거절한다.
    mockPostSocialTokenLogin.mockRejectedValue(ageConfirmationRequired());
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('kakao', authorizeToken('kakao-access-token'));
    });

    // 단언 — 실패 배너가 아니라 연령확인 단계다. 이 전이가 없으면 신규 가입이 통째로 막힌다.
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));
    // BR-U0-05 — 사용자가 확인하기 전에는 계정도 토큰도 확정하지 않는다.
    expect(mockSaveTokens).not.toHaveBeenCalled();
    expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(1);
    // 대조 — code 경로로 새지 않았다.
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
  });
});

describe('TRIP-248 AC-7 · 재전송은 같은 accessToken 을 /token 으로 다시 보낸다', () => {
  it('confirmAge 는 첫 요청과 같은 accessToken 에 ageConfirmation 만 붙여 보내고, 성공하면 저장한다', async () => {
    // 준비 — 첫 호출만 400 으로 거절하고, 두 번째(연령확인 동봉)부터는 계정을 만들어 준다.
    // accessToken 은 만료 전까지 재사용 가능하므로 갈래를 바꾸거나 다시 인가받을 필요가 없다.
    mockPostSocialTokenLogin
      .mockRejectedValueOnce(ageConfirmationRequired())
      .mockResolvedValue(tokenPair(true));
    const { result } = renderSocialLogin();

    // 실행 1 — 첫 로그인 → 연령확인 단계까지.
    act(() => {
      result.current.signIn('kakao', authorizeToken('kakao-access-token'));
    });
    await waitFor(() => expect(result.current.phase).toBe('needs-age'));

    // 실행 2 — 사용자가 만 14세 확인.
    act(() => {
      result.current.confirmAge();
    });

    // 단언 — 두 번째 호출 인자를 **완전 일치**로 본다. 여분 필드가 붙거나 accessToken 이
    // 바뀌면 실패한다.
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(mockPostSocialTokenLogin).toHaveBeenCalledTimes(2);
    expect(mockPostSocialTokenLogin.mock.calls[1]).toEqual([
      'kakao',
      {
        accessToken: 'kakao-access-token',
        ageConfirmation: { method: 'SELF_DECLARED' },
      },
    ]);
    // 핵심 — 재전송이 code 경로로 새지 않았다. 여기가 갈리면 실서버가 거부한다.
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
    expect(mockSaveTokens).toHaveBeenCalledTimes(1);
  });
});

/**
 * TRIP-248 AC-4·5·6 — 400 을 통째로 삼키지 않는다.
 *
 * 이 세 케이스는 지금 구현에서도 이미 통과한다(모든 400 이 error 로 떨어지므로). 그래도 쓰는
 * 이유는 구현 방향이 "error 를 좁게 뚫는 일"이기 때문이다 — 벽이 없으면
 * `code === 'VALIDATION_ERROR'` 한 줄로 뚫어도 red 가 안 난다.
 *
 * 세 케이스는 서로 **다른 구현 실수**를 잡는다:
 *  - AC-4: 다른 필드가 틀린 400 까지 연령 시트로 보내는 실수
 *  - AC-5: `fields` 가 없을 때 터지는 실수(계약상 fields 는 선택이고 원소도 빈 객체일 수 있다)
 *  - AC-6: 필드명을 부분일치로 보는 실수
 */
describe('TRIP-248 AC-4·5·6 · 그 밖의 400 은 error 로 남는다', () => {
  async function expectStaysError(rejectedValue: unknown) {
    // 준비
    mockPostSocialTokenLogin.mockRejectedValue(rejectedValue);
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('kakao', authorizeToken('kakao-access-token'));
    });

    // 단언 — 구현이 catch 안에서 예외를 던지면 error 로 전이하지도 못하고 'exchanging' 에
    // 갇히므로, 이 한 줄이 "예외로 죽지 않는다"(AC-5)까지 함께 덮는다.
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(mockSaveTokens).not.toHaveBeenCalled();
  }

  it('AC-4 — fields 에 ageConfirmation 이 없으면(deviceId) 연령 시트로 가지 않는다', async () => {
    await expectStaysError({
      code: 'VALIDATION_ERROR',
      fields: [
        { field: 'deviceId', reason: '기기 식별자가 올바르지 않습니다' },
      ],
    });
  });

  it('AC-5 — fields 키가 아예 없어도 예외로 죽지 않는다', async () => {
    // openapi ErrorResponse 에서 fields 는 선택 필드다 — 없는 응답이 계약상 정상이다.
    await expectStaysError({ code: 'VALIDATION_ERROR' });
  });

  it('AC-5 — fields 원소가 빈 객체({})여도 예외로 죽지 않는다', async () => {
    // 원소의 field·reason 도 required 가 아니다(openapi :1170-1177) — {} 도 적법하다.
    await expectStaysError({ code: 'VALIDATION_ERROR', fields: [{}] });
  });

  it('AC-6 — 필드명은 완전일치다: ageConfirmation.birthDate 는 시트를 띄우지 않는다', async () => {
    // 백엔드가 실제로 던지는 **두 번째** FieldError 다(AuthenticateWithSocialUseCase.kt:80).
    // startsWith/includes 로 짜면 이 케이스가 잘못 시트를 띄운다.
    await expectStaysError({
      code: 'VALIDATION_ERROR',
      fields: [
        {
          field: 'ageConfirmation.birthDate',
          reason: '생년월일 연령확인은 생년월일이 필요합니다',
        },
      ],
    });
  });
});

describe('TRIP-248 AC-13 · code 갈래(구글)의 같은 400 은 error 로 남는다 (D3)', () => {
  /**
   * ⚠️ **나중에 뒤집어야 할 심판이다 — 영구 규칙이 아니다.**
   *
   * 왜 지금은 error 인가: code 갈래(브라우저 OAuth)의 인가코드는 1회용이라, 서버가 첫 요청에서
   * 이미 소진했다. 연령확인을 받아 재전송하려면 인가를 **다시** 받아야 하는데(재인가), 이 칸은
   * 카카오(token 갈래)만 다루므로 재인가를 만들지 않았다(D0). 재인가 없이 시트를 띄우면
   * 사용자는 "네, 확인했어요"를 누른 **뒤에** 401 을 받는다 — 지금(즉시 배너)보다 나쁘다.
   *
   * code 갈래 재인가(BR-U0-02 잔여)를 붙이는 칸에서는 이 기대값이 needs-age 로 바뀐다.
   */
  it('code 갈래는 연령확인 누락 400 을 받아도 needs-age 가 아니라 error 다', async () => {
    // 준비 — AC-1 과 **똑같은** 에러를 준다. 갈래만 다르다.
    mockPostSocialLogin.mockRejectedValue(ageConfirmationRequired());
    const { result } = renderSocialLogin();

    // 실행
    act(() => {
      result.current.signIn('google', authorizeCode);
    });

    // 단언 — 갈래를 안 보고 400 만 보는 구현은 여기서 needs-age 로 가서 실패한다.
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
    expect(mockSaveTokens).not.toHaveBeenCalled();
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
