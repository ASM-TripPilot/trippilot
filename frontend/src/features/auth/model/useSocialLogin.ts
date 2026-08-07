import { useCallback, useRef, useState } from 'react';

import {
  postSocialLogin,
  postSocialTokenLogin,
  type NormalizedApiError,
  type SocialLoginBody,
  type SocialProvider,
  type SocialTokenLoginBody,
} from '@/shared/api';
import { setAccessToken } from '@/shared/api/tokenManager';
import { saveTokens } from '@/shared/storage';

export type SocialLoginPhase =
  | 'idle'
  | 'authorizing'
  | 'exchanging'
  | 'needs-age'
  | 'success'
  | 'cancelled'
  | 'error';

// TRIP-210 D1 — 성공 멤버가 둘로 갈렸다. code 경로(브라우저 OAuth, PKCE 3필드)는 인가 코드를
// 서버가 교환해야 하고, token 경로(네이티브 SDK)는 이미 access token 을 쥐고 있어 그대로
// 넘긴다. 두 성공 멤버 모두 판별자 이름은 그대로 `type` 을 쓴다(현행 유지 · 재질문 금지).
export type AuthorizeResult =
  | {
      type: 'success-code';
      authorizationCode: string;
      codeVerifier: string;
      redirectUri: string;
    }
  | { type: 'success-token'; accessToken: string }
  | { type: 'cancel' }
  | { type: 'dismiss' };

export type Authorize = () => Promise<AuthorizeResult>;

/** 서버로 나가기 직전까지 들고 있는 교환 요청 — 갈래별로 엔드포인트와 바디 모양이 다르므로
 * kind 로 태그해 exchange()가 어느 함수를 부를지 고른다. confirmAge() 재전송도 같은 갈래를
 * 유지한 채 ageConfirmation 만 덧붙인다. */
type PendingExchange =
  | { kind: 'code'; provider: SocialProvider; body: SocialLoginBody }
  | { kind: 'token'; provider: SocialProvider; body: SocialTokenLoginBody };

interface SocialLoginState {
  signIn: (provider: SocialProvider, authorize: Authorize) => void;
  confirmAge: () => void;
  phase: SocialLoginPhase;
  errorCode: string | null;
  conflictProvider: string | null;
  isNewUser: boolean;
}

// TRIP-172(결함 E) — authorize() 자체가 던지는 실패(예: 실 OAuth client 미설정, promptAsync
// 예외)에 붙이는 코드. 사용자 취소({type:'cancel'|'dismiss'} resolve)와 반드시 분리된다 —
// 그건 phase='cancelled'로 가고 errorCode 를 채우지 않는다(7-21).
const AUTHORIZE_FAILED_CODE = 'AUTHORIZE_FAILED';

/**
 * TRIP-248 — 서버가 "연령확인이 아직 없다"는 뜻으로 거절했는가. 실서버는 신규 가입의 첫 요청을
 * 반드시 이 모양으로 되돌린다(AuthenticateWithSocialUseCase.kt:76-77).
 *
 * 필드명은 **완전일치**로 본다 — 같은 유스케이스가 던지는 `ageConfirmation.birthDate` 는
 * "생년월일이 빠졌다"는 다른 실패라, 접두사로 보면 연령확인 시트가 잘못 뜬다.
 * 상태코드는 보지 않는다(D2) — 연령 관련 상태가 정본(422)과 백엔드 구현(403)으로 이미 갈린
 * 전례가 있어, body 의 code+fields 만 보면 서버가 상태를 바꿔도 프론트가 안 깨진다.
 */
function isAgeConfirmationRequired(
  error: Partial<NormalizedApiError>
): boolean {
  return (
    error.code === 'VALIDATION_ERROR' &&
    (error.fields ?? []).some((f) => f.field === 'ageConfirmation')
  );
}

/**
 * 소셜 로그인 오케스트레이션. provider 인가는 `authorize` 로 주입받고(PKCE 실구현은
 * 어댑터 뒤에 숨는다), 교환 바디에는 codeVerifier 만 실어 서버로 나른다(시크릿 비노출).
 * 신규 판정 시 토큰을 커밋하지 않고 연령확인(SELF_DECLARED) 재전송 후 저장한다.
 *
 * TRIP-172(결함 E) — 인가/교환 중('authorizing'/'exchanging')에는 새 signIn 을 무시한다
 * (연속 탭이 provider 를 섞거나 인가코드를 중복 교환하지 않도록). state 는 다음 렌더까지
 * 반영되지 않아 신뢰할 수 없으므로, phaseRef 로 "지금 이 순간의" phase 를 동기로 추적한다.
 */
export function useSocialLogin(): SocialLoginState {
  const [phase, setPhase] = useState<SocialLoginPhase>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [conflictProvider, setConflictProvider] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);

  const phaseRef = useRef<SocialLoginPhase>('idle');
  const applyPhase = useCallback((next: SocialLoginPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const pendingRef = useRef<PendingExchange | null>(null);

  const exchange = useCallback(
    async (pending: PendingExchange, ageConfirmed: boolean) => {
      try {
        const tokens =
          pending.kind === 'code'
            ? await postSocialLogin(pending.provider, pending.body)
            : await postSocialTokenLogin(pending.provider, pending.body);
        setIsNewUser(tokens.isNewUser);
        await saveTokens({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        });
        setAccessToken(tokens.accessToken);
        applyPhase('success');
      } catch (error) {
        const normalized = error as Partial<NormalizedApiError>;
        // TRIP-248 — 연령확인 누락 거절은 실패가 아니라 "확인이 더 필요하다"는 신호다. 재전송이
        // 가능한 token 갈래에서만(D3) 시트로 보낸다: code 갈래의 인가코드는 첫 요청에서 이미
        // 소진돼, 확인을 받아 같은 코드로 다시 보내면 반드시 401 이다. 이미 확인을 실어 보낸
        // 재전송이 또 이 거절을 받으면 시트를 반복해 띄우지 않고 에러로 표면화한다(INV-4).
        if (
          !ageConfirmed &&
          pending.kind === 'token' &&
          isAgeConfirmationRequired(normalized)
        ) {
          applyPhase('needs-age');
          return;
        }
        setErrorCode(normalized.code ?? 'UNKNOWN');
        setConflictProvider(normalized.existingProvider ?? null);
        applyPhase('error');
      }
    },
    [applyPhase]
  );

  const signIn = useCallback(
    (provider: SocialProvider, authorize: Authorize) => {
      if (
        phaseRef.current === 'authorizing' ||
        phaseRef.current === 'exchanging'
      ) {
        // 흐름 잠금 — 인가/교환 진행 중의 새 시도는 no-op(Seed §5 동시성안전).
        return;
      }
      setErrorCode(null);
      setConflictProvider(null);
      setIsNewUser(false);
      applyPhase('authorizing');
      void (async () => {
        let result: AuthorizeResult;
        try {
          result = await authorize();
        } catch {
          // authorize() 자체의 예외는 사용자 취소가 아니라 시스템 실패다(INV-4 — 침묵 금지).
          // 취소는 {type:'cancel'|'dismiss'} resolve 로 오므로 이 catch 에 걸리지 않는다.
          setErrorCode(AUTHORIZE_FAILED_CODE);
          applyPhase('error');
          return;
        }
        if (result.type === 'cancel' || result.type === 'dismiss') {
          applyPhase('cancelled');
          return;
        }
        // D1 갈래 분기 — code(브라우저 OAuth)는 postSocialLogin, token(네이티브 SDK)은
        // postSocialTokenLogin. 여기서 갈리면 반대 엔드포인트로 나가 실서버가 거부한다.
        const pending: PendingExchange =
          result.type === 'success-code'
            ? {
                kind: 'code',
                provider,
                body: {
                  authorizationCode: result.authorizationCode,
                  codeVerifier: result.codeVerifier,
                  redirectUri: result.redirectUri,
                },
              }
            : {
                kind: 'token',
                provider,
                body: { accessToken: result.accessToken },
              };
        pendingRef.current = pending;
        applyPhase('exchanging');
        await exchange(pending, false);
      })();
    },
    [applyPhase, exchange]
  );

  const confirmAge = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) {
      return;
    }
    applyPhase('authorizing');
    const ageConfirmation = { method: 'SELF_DECLARED' as const };
    const resend: PendingExchange =
      pending.kind === 'code'
        ? { ...pending, body: { ...pending.body, ageConfirmation } }
        : { ...pending, body: { ...pending.body, ageConfirmation } };
    void exchange(resend, true);
  }, [applyPhase, exchange]);

  return { signIn, confirmAge, phase, errorCode, conflictProvider, isNewUser };
}
