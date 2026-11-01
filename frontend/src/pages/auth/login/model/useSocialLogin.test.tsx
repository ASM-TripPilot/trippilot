import { act, renderHook, waitFor } from '@testing-library/react-native';

import { postSocialLogin, postSocialTokenLogin } from '@/shared/api';
import { saveTokens } from '@/shared/storage';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';
import {
  tokenPair,
  ageConfirmationRequired,
  authorizeWith,
} from './__fixtures__/socialLogin';
import { useSocialLogin, type AuthorizeResult } from './useSocialLogin';

/**
 * useSocialLogin 훅 — 한 파일로 합쳤다(README 판정 4): 옛 `useSocialLogin{,.tokenPath,.apple,.codeAgeFirst}.test.tsx` 4개를
 * 각자의 바깥 describe 로 옮겼다. 목·목 핸들·`renderSocialLogin`·서버 목 리셋은 4벌이 같아 머리에 한 번만 둔다. 이름이 같고
 * 모양이 다른 인가 스텁과 각자 더 거는 `beforeEach` 는 describe 안에 갇혀 그대로다.
 */

// TRIP-1157: 훅이 tokenManager 를 @/shared/api(배럴)로 문다 — 통째로 갈아끼우면 토큰 함수가 지워지므로 실물 tokenManager 를 펼친다.
jest.mock('@/shared/api', () => ({
  ...jest.requireActual('@/shared/api/tokenManager'),
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

function renderSocialLogin() {
  return renderHook(() => useSocialLogin(), {
    wrapper: createWrapper(newTestQueryClient()),
  });
}

beforeEach(() => {
  mockPostSocialLogin.mockReset();
  mockPostSocialTokenLogin.mockReset();
  mockSaveTokens.mockReset().mockResolvedValue(undefined);
});

describe('기본 — code 교환·에러 매핑·연타 잠금', () => {
  // TRIP-210 — 이전 판은 여기에 AuthorizeResult 를 **손으로 복사**해 뒀다. 프로덕션 유니온이
  // 넓어져도 사본은 따라오지 않아, 낡은 형태로 계속 green 일 수 있는 자리였다(브리프 §5-3 참고).
  // 프로덕션 타입을 직접 import 해 그 드리프트를 구조적으로 없앤다.

  const authorizeSuccess = jest.fn(async (): Promise<AuthorizeResult> => ({
    type: 'success-code',
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

  beforeEach(() => {
    authorizeSuccess.mockClear();
    authorizeReject.mockClear();
  });

  describe('useSocialLogin — 신규 가입 PKCE 교환 (AC-ONB-01-1·3 · TRIP-248 AC-10)', () => {
    // TRIP-248 D1 — 200 응답의 isNewUser 를 보고 연령확인 단계로 가던 분기를 지웠다. 실서버에서
    // 도달 불가한 분기였기 때문이다(신규의 첫 요청은 반드시 400). 그래서 이 케이스의 기대가
    // needs-age 에서 success 로 바뀌었고, 픽스처는 **일부러 isNewUser:true 를 유지한다** —
    // 죽은 분기가 남아 있으면 여기서 걸린다.
    it('provider 동의 code 를 PKCE 바디로 교환하고, 첫 요청에는 연령확인을 싣지 않는다', async () => {
      mockPostSocialLogin.mockResolvedValue(tokenPair(true));
      const { result } = renderSocialLogin();

      act(() => {
        result.current.signIn('google', authorizeSuccess);
      });

      await waitFor(() => expect(result.current.phase).toBe('success'));

      expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
      const [provider, body] = mockPostSocialLogin.mock.calls[0];
      expect(provider).toBe('google');
      expect(body).toMatchObject({
        authorizationCode: 'auth-code-123',
        codeVerifier: 'verifier-xyz',
        redirectUri: 'trippilot://oauth/google',
      });
      // 사용자가 선언하지 않은 연령확인을 append-only 법정 동의 로그에 남기면 안 된다.
      expect(body.ageConfirmation).toBeUndefined();
      expect(result.current.isNewUser).toBe(true);
      expect(mockSaveTokens).toHaveBeenCalledTimes(1);
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

  // TRIP-248 — 이 describe 에 있던 "code 갈래 confirmAge 재전송" 케이스는 삭제했다. D0(code 갈래
  // 재인가를 만들지 않는다) + D1(200→needs-age 분기 제거) + D3(code 갈래의 400 은 error 로 남긴다)
  // 를 합치면 code 갈래는 needs-age 에 도달할 경로가 없어, 그 케이스는 실서버에 존재하지 않는
  // 흐름을 지키고 있었다. token 갈래의 재전송 심판은 이 파일 token 갈래 describe 에 있다(옛 .tokenPath 합본).
  describe('useSocialLogin — 연령 미달 응답 (AC-ONB-01-7)', () => {
    it('연령 미달로 서버가 422 AgeNotMet 를 반환하면 계정 미생성·에러(AGE_NOT_MET)로 남는다', async () => {
      mockPostSocialLogin.mockRejectedValue({
        code: 'AGE_NOT_MET',
        status: 422,
      });
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

  describe('useSocialLogin — 연속 탭 잠금 (AC-S5 · Seed §5 동시성안전 · 케이스 12·13)', () => {
    it("인가 중('authorizing') 두 번째 탭은 무시된다 — provider 가 섞이지 않는다", async () => {
      // 준비 — 첫 인가(google)는 바깥에서 풀어줄 때까지 끝나지 않는다. 두 번째(kakao)는
      // 즉시 success 지만 "잠금 대상"이라 호출조차 되면 안 된다.
      const { authorize: authorizeBlocked, release } = createDeferredAuthorize({
        type: 'success-code',
        authorizationCode: 'auth-code-blocked',
        codeVerifier: 'verifier-blocked',
        redirectUri: 'trippilot://oauth/google',
      });
      const authorizeSecond = jest.fn(async (): Promise<AuthorizeResult> => ({
        type: 'success-code',
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
        type: 'success-code',
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
});

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
describe('token 갈래 (옛 .tokenPath — TRIP-248)', () => {
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

  beforeEach(() => {
    authorizeCode.mockClear();
  });

  describe('AC-1(훅) · 카카오 토큰 갈래는 /token 호출자로만 나간다', () => {
    it('accessToken 만 실어 postSocialTokenLogin("kakao") 을 부르고, 성공하면 저장 후 success 가 된다', async () => {
      // 준비 — 기존 사용자(isNewUser:false)라 연령확인 없이 바로 저장까지 간다.
      mockPostSocialTokenLogin.mockResolvedValue(tokenPair(false, 'KAKAO'));
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
      mockPostSocialTokenLogin.mockResolvedValue(tokenPair(false, 'KAKAO'));
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
        .mockResolvedValue(tokenPair(true, 'KAKAO'));
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

  describe('TRIP-1035 AC-6·7 · 갈래 판정 없이 온 code 결과는 선언을 싣지 않고, 400 이면 error 다 (구 TRIP-248 AC-13)', () => {
    /**
     * TRIP-248 때 "나중에 뒤집을 심판"으로 남긴 자리다. 뒤집힌 쪽 — code 갈래(flow='code')는 인가
     * **전에** 묻고 첫 요청에 선언을 싣는다 — 은 이 파일 codeAgeFirst describe 에 있다(옛 .codeAgeFirst 합본).
     *
     * 여기 남은 것은 authorize 에 갈래 표지(flow)가 **없는** 경로다. 표지가 없으면 token 으로 취급해
     * 묻지 않고 인가하므로, 결과가 code 로 와도 사용자는 선언한 적이 없다 → body 에 선언이 없어야 하고
     * (AC-6), 인가코드는 첫 요청에서 이미 소진됐으니 400 을 받아도 시트로 가지 않고 error 다(D3 승계).
     */
    it('표지 없는 authorize 가 success-code 를 주면 선언 없이 보내고, 연령확인 누락 400 은 needs-age 가 아니라 error 다', async () => {
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
      // AC-6 — 키 **부재**를 본다(toBeUndefined 는 { ageConfirmation: undefined } 를 통과시킨다).
      expect(mockPostSocialLogin).toHaveBeenCalledTimes(1);
      expect(Object.keys(mockPostSocialLogin.mock.calls[0][1])).not.toContain(
        'ageConfirmation'
      );
    });
  });

  describe('AC-4 · google 은 기존 code 교환 경로에 남는다 (D3)', () => {
    it('code 갈래는 postSocialLogin 으로 가고 /token 호출자는 건드리지 않는다', async () => {
      // 준비 — 이 칸은 카카오·네이버만 옮긴다. google 이 딸려 오면 실서버가 거부한다.
      mockPostSocialLogin.mockResolvedValue(tokenPair(false, 'KAKAO'));
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

  // 취소 계약의 정본 자리 — 옛 `useSocialLogin.test.tsx` 의 「취소 (AC-ONB-01-4)」·「취소·실패 분리 (AC-S5)」와 이 파일의
  // AC-5(훅)를 합쳤다(TRIP-1355: 같은 cancel/dismiss 흐름). 두 엔드포인트가 나란히 목이라 "어느 쪽으로도 안 나간다"까지 본다.
  describe('취소 계약 · AC-ONB-01-4 · AC-S5 · AC-5(훅) — 취소·dismiss 는 실패가 아니고 서버로 나가지도 않는다', () => {
    it.each([
      // 카카오 reject 도 네이버 isCancel 도 어댑터에서 이 한 형태로 합쳐진다(T1-3·T1-4) — 훅은 합쳐진 결과만 본다.
      ['cancel', 'google'],
      ['dismiss', 'naver'],
      ['cancel', 'kakao'],
    ] as const)(
      '인가 결과 %s (%s) → phase=cancelled · errorCode=null 이고 두 엔드포인트·토큰 저장 모두 0회다',
      async (type, provider) => {
        // 준비 — 취소(resolve) 전용 목. reject 목과 겸용하지 않는다(7-21).
        const authorizeCancelled = jest.fn(
          async (): Promise<AuthorizeResult> => ({ type })
        );
        const { result } = renderSocialLogin();

        // 실행
        act(() => {
          result.current.signIn(provider, authorizeCancelled);
        });

        // 단언 — errorCode 가 채워지면 화면에 실패 배너가 뜬다(INV-4 의 반대 방향 위반).
        await waitFor(() => expect(result.current.phase).toBe('cancelled'));
        expect(result.current.errorCode).toBeNull();
        expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
        expect(mockPostSocialLogin).not.toHaveBeenCalled();
        expect(mockSaveTokens).not.toHaveBeenCalled();
      }
    );
  });
});

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
describe('애플 token 갈래의 서버 바디 (옛 .apple — TRIP-932)', () => {
  const APPLE_RESULT: AuthorizeResult = {
    type: 'success-token',
    accessToken: 'id-tok',
    authorizationCode: 'auth-code',
  };

  describe('AC-6 · 애플 token 갈래는 accessToken 과 authorizationCode 를 함께 보낸다', () => {
    it('postSocialTokenLogin("apple", { accessToken, authorizationCode }) 를 완전 일치로 부르고 code 경로는 안 부른다', async () => {
      // 준비
      mockPostSocialTokenLogin.mockResolvedValue(tokenPair(false, 'APPLE'));
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
        mockPostSocialTokenLogin.mockResolvedValue(tokenPair(false, 'APPLE'));
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
        .mockResolvedValue(tokenPair(true, 'APPLE'));
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
});

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
describe('code 갈래는 연령확인을 인가 전에 (옛 .codeAgeFirst — TRIP-1035)', () => {
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
});
